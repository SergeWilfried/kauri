import { useMemo, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { errorMessage, fmt } from '../components'
import { I } from '../icons'
import { FIELDS, IMPORT_REASONS as REASONS, buildItems, downloadText, guessMapping, readRows, toCsv } from '../lib/sheet'
import { Pager, usePaged } from '../components/Pager'
import { WizardFoot, WizardSteps } from '../components/Wizard'
import { confirmDialog } from '../components/ConfirmDialog'

const BATCH = 200 // = IMPORT_BATCH_SIZE in convex/imports.ts
const WIZARD = ["Fichiers", "Vérification", "Import"]
const STEPS = [
  { key: "clients", label: "Clients" },
  { key: "tx", label: "Transactions" },
  { key: "align", label: "Soldes" },
]

/** Read one backup file and check it has the columns the old app exports. */
async function readBackupFile(file, kind) {
  const rows = await readRows(file)
  if (rows.length < 2) throw new Error("Fichier vide.")
  const headers = rows[0].map((h) => String(h ?? "").trim())
  const mapping = guessMapping(kind, headers)
  const required = kind === "backupClients"
    ? FIELDS.backupClients.filter((f) => f.required)
    : FIELDS.transactions.filter((f) => ["legacyClientId", "type", "amount", "date"].includes(f.key))
  const missing = required.filter((f) => !(mapping[f.key] >= 0))
  if (missing.length) throw new Error(`Colonnes manquantes : ${missing.map((f) => f.label).join(", ")}.`)
  return { name: file.name, items: buildItems(kind, rows.slice(1), mapping) }
}

/** One file slot: name, row count, pick button and read error. */
function FilePick({ title, hint, file, error, disabled, onPick }) {
  const ref = useRef(null)
  return (
    <div className="upload" style={{ marginTop: 10 }}>
      <I.Folder size={20}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 550, fontSize: 13 }}>{title}{file && <span className="cell-sub"> · {file.name}</span>}</div>
        <div className="cell-sub" style={error ? { color: "var(--neg)" } : undefined}>
          {error ?? (file ? `${file.items.length} ligne${file.items.length > 1 ? "s" : ""}` : hint)}
        </div>
      </div>
      <input ref={ref} type="file" accept=".csv,.xlsx,.txt" hidden onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = "" }}/>
      <button className="btn sm" style={{ marginLeft: "auto" }} disabled={disabled} onClick={() => ref.current?.click()}>
        {file ? "Changer…" : "Choisir…"}
      </button>
    </div>
  )
}

/**
 * Import of the old app's backup: the clients file (with client ID and Solde)
 * and, optionally, the transactions file. Runs three steps — create clients,
 * import their history, then align each balance on the backup's Solde — and
 * reports every line that was skipped, refused or adjusted.
 */
export default function BackupImport({ onBusy }) {
  const importCustomers = useMutation(api.imports.importCustomers)
  const importTransactions = useMutation(api.imports.importTransactions)
  const alignBalances = useMutation(api.imports.alignBalances)
  const [clients, setClients] = useState(null)
  const [txs, setTxs] = useState(null)
  const [errors, setErrors] = useState({})
  const [run, setRun] = useState(null) // { step, done, total, results: {clients, tx, align}, finished, error }
  const [wizard, setWizard] = useState(0) // index in WIZARD

  const pick = (kind, set, slot) => async (file) => {
    if (!file) return
    setRun(null)
    try {
      set(await readBackupFile(file, kind))
      setErrors((e) => ({ ...e, [slot]: null }))
    } catch (e) {
      set(null)
      setErrors((x) => ({ ...x, [slot]: e.message?.startsWith("Colonnes") || e.message === "Fichier vide." ? e.message : "Fichier illisible (.csv ou .xlsx attendu)." }))
    }
  }

  // What the preview can tell before anything is sent
  const preview = useMemo(() => {
    if (!clients) return null
    const okClients = clients.items.filter((i) => i.payload)
    const known = new Set(okClients.map((i) => i.payload.legacyId.toUpperCase()))
    const okTx = txs ? txs.items.filter((i) => i.payload) : []
    const history = new Map()
    for (const t of okTx) {
      const k = t.payload.legacyClientId?.toUpperCase()
      history.set(k, (history.get(k) ?? 0) + (t.payload.type === "deposit" ? t.payload.amount : -t.payload.amount))
    }
    return {
      okClients: okClients.length,
      badClients: clients.items.length - okClients.length,
      okTx: okTx.length,
      badTx: txs ? txs.items.length - okTx.length : 0,
      orphanTx: okTx.filter((t) => !known.has(t.payload.legacyClientId?.toUpperCase())).length,
      toAdjust: okClients.filter((c) => (history.get(c.payload.legacyId.toUpperCase()) ?? 0) !== c.balance).length,
    }
  }, [clients, txs])

  const start = async () => {
    if (!txs && !(await confirmDialog({
      title: "Importer sans l'historique ?",
      message: "Sans le fichier transactions, chaque Solde sera enregistré en une seule ligne d'ajustement, sans historique. " +
        "Si vous importez l'historique plus tard, relancez la sauvegarde avec les deux fichiers pour corriger ces ajustements.",
      confirmLabel: "Importer quand même",
    }))) return
    const results = { clients: [], tx: [], align: [] }
    const local = (file) => (file ? file.items.filter((i) => i.error).map((i) => ({ row: i.row, status: "error", code: i.error })) : [])
    results.clients.push(...local(clients))
    if (txs) results.tx.push(...local(txs))
    const plan = [
      { key: "clients", rows: clients.items.filter((i) => i.payload).map((i) => i.payload), send: importCustomers },
      { key: "tx", rows: txs ? txs.items.filter((i) => i.payload).map((i) => i.payload) : [], send: importTransactions },
      {
        key: "align",
        rows: clients.items.filter((i) => i.payload).map((i) => ({ row: i.row, legacyId: i.payload.legacyId, balance: i.balance })),
        send: alignBalances,
      },
    ]
    onBusy?.(true)
    setWizard(2)
    try {
      for (const [n, step] of plan.entries()) {
        setRun({ step: n, done: 0, total: step.rows.length, results, finished: false })
        for (let i = 0; i < step.rows.length; i += BATCH) {
          const chunk = step.rows.slice(i, i + BATCH)
          results[step.key].push(...(await step.send({ rows: chunk })))
          setRun({ step: n, done: i + chunk.length, total: step.rows.length, results: { ...results }, finished: false })
        }
      }
      setRun((r) => ({ ...r, finished: true }))
    } catch (e) {
      // Earlier batches are saved; running the same files again skips them
      setRun((r) => ({ ...r, finished: true, error: errorMessage(e) }))
    } finally {
      onBusy?.(false)
    }
  }

  const labels = useMemo(() => ({
    clients: new Map((clients?.items ?? []).map((i) => [i.row, i.label ?? ""])),
    tx: new Map((txs?.items ?? []).map((i) => [i.row, i.label ?? ""])),
    align: new Map((clients?.items ?? []).map((i) => [i.row, i.label ?? ""])),
  }), [clients, txs])

  const report = run
    ? STEPS.flatMap((s) => run.results[s.key]
        .filter((r) => !(r.status === "created" && s.key !== "align"))
        .filter((r) => r.code !== "BALANCE_OK")
        .map((r) => ({ ...r, file: s.label, client: labels[s.key].get(r.row) || "—" })))
    : []
  const reportPage = usePaged(report)
  const statusLabel = (r) =>
    r.status === "created" ? "Ajusté" : r.status === "updated" ? "Ajustement corrigé" : r.status === "skipped" ? "Ignorée" : "Erreur"
  const reason = (r) => r.status === "created" || r.status === "updated"
    ? `Solde aligné sur la sauvegarde (${r.delta > 0 ? "+" : "−"}${fmt(Math.abs(r.delta))} F)`
    : REASONS[r.code] ?? r.code
  const created = (k) => (run ? run.results[k].filter((r) => r.status === "created" || r.status === "updated").length : 0)

  const restart = () => { setClients(null); setTxs(null); setErrors({}); setRun(null); setWizard(0) }

  return (
    <div className="card">
      <WizardSteps steps={WIZARD} current={wizard}/>

      {wizard === 0 && <>
        <div className="wiz-body" style={{ paddingTop: 6 }}>
          <FilePick title="Fichier clients" hint="clients-AAAA-MM-JJ.csv : ID, Nom, Numéro de compte, Solde, Téléphone…"
            file={clients} error={errors.clients} onPick={pick("backupClients", setClients, "clients")}/>
          <FilePick title="Fichier transactions (facultatif)" hint="transactions-AAAA-MM-JJ.csv : ID, ID Client, Type, Montant, Date, Heure, Agent…"
            file={txs} error={errors.tx} onPick={pick("transactions", setTxs, "tx")}/>
        </div>
        <WizardFoot>
          <button className="btn brand" disabled={!clients} onClick={() => setWizard(1)}>Suivant ›</button>
        </WizardFoot>
      </>}

      {wizard === 1 && preview && <>
        <div className="wiz-body">
          <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li><strong>{preview.okClients}</strong> client(s) à créer{preview.badClients > 0 && <span style={{ color: "var(--neg)" }}> · {preview.badClients} ligne(s) en erreur</span>}</li>
            {txs
              ? <li><strong>{preview.okTx}</strong> transaction(s) d'historique{preview.badTx > 0 && <span style={{ color: "var(--neg)" }}> · {preview.badTx} ligne(s) en erreur</span>}
                  {preview.orphanTx > 0 && <span style={{ color: "var(--neg)" }}> · {preview.orphanTx} pour un client absent du fichier clients</span>}</li>
              : <li>Pas de fichier transactions : chaque Solde sera enregistré en une seule ligne d'ajustement, sans historique.</li>}
            <li><strong>{preview.toAdjust}</strong> solde(s) où l'historique ne donne pas le Solde de la sauvegarde : une ligne « Ajustement import » les alignera.</li>
          </ul>
        </div>
        <WizardFoot onBack={() => setWizard(0)}>
          <button className="btn brand" disabled={preview.okClients === 0} onClick={start}>
            <I.ArrowDown size={14} stroke="white"/>Importer la sauvegarde
          </button>
        </WizardFoot>
      </>}

      {wizard === 2 && run && <>
        <div className="wiz-body">
          <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 13, flexWrap: "wrap" }}>
            {STEPS.map((s, n) => (
              <span key={s.key} className={"tag " + (n < run.step || run.finished ? "actif" : n === run.step ? "attente" : "archive")}>
                {n + 1}. {s.label}{n === run.step && !run.finished ? ` ${run.done}/${run.total}` : ""}
              </span>
            ))}
          </div>
          {run.finished && (
            <div style={{ display: "flex", gap: 20, fontSize: 13, flexWrap: "wrap" }}>
              <span><strong>{created("clients")}</strong> client(s) créé(s)</span>
              <span><strong>{created("tx")}</strong> transaction(s) importée(s)</span>
              <span><strong>{created("align")}</strong> solde(s) ajusté(s)</span>
              <span><strong>{report.filter((r) => r.status === "skipped").length}</strong> ignorée(s)</span>
              <span style={{ color: report.some((r) => r.status === "error") ? "var(--neg)" : undefined }}>
                <strong>{report.filter((r) => r.status === "error").length}</strong> en erreur
              </span>
            </div>
          )}
          {run.error && (
            <div role="alert" style={{ color: "var(--neg)", fontSize: 13, marginTop: 10 }}>
              Import interrompu : {run.error} Ce qui est déjà importé est enregistré ; relancez avec les mêmes fichiers pour continuer.
            </div>
          )}
        </div>
        {run.finished && report.length > 0 && <>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Fichier</th><th>Ligne</th><th>Client</th><th>Statut</th><th>Motif</th></tr></thead>
              <tbody>
                {reportPage.rows.map((r) => (
                  <tr key={r.file + r.row}>
                    <td className="cell-sub">{r.file}</td>
                    <td className="cell-sub">{r.row}</td>
                    <td>{r.client}</td>
                    <td><span className={"tag " + (r.status === "created" || r.status === "updated" ? "actif" : r.status === "skipped" ? "attente" : "archive")}>{statusLabel(r)}</span></td>
                    <td>{reason(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager paged={reportPage}/>
        </>}
        {run.finished && (
          <WizardFoot>
            {report.length > 0 && (
              <button className="btn" onClick={() => downloadText("rapport-import-sauvegarde.csv",
                toCsv([["Fichier", "Ligne", "Client", "Statut", "Motif"], ...report.map((r) => [r.file, r.row, r.client, statusLabel(r), reason(r)])]))}>
                <I.Export size={14}/>Rapport CSV
              </button>
            )}
            <button className="btn brand" onClick={restart}>Nouvel import</button>
          </WizardFoot>
        )}
      </>}
    </div>
  )
}
