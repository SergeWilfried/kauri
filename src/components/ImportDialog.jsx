import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { errorMessage, fmt } from '../components'
import { I } from '../icons'
import { FIELDS, IMPORT_REASONS as REASONS, TEMPLATES, buildItems, downloadText, guessMapping, readRows, toCsv } from '../lib/sheet'
import BackupImport from '../pages/BackupImport'
import { Pager, usePaged } from './Pager'
import { WizardFoot, WizardSteps } from './Wizard'

const BATCH = 200 // = IMPORT_BATCH_SIZE in convex/imports.ts
const STEPS = ["Fichier", "Colonnes", "Aperçu", "Résultat"]

const KINDS = {
  backup: {
    label: "Sauvegarde de l'ancienne application",
    note: "Les deux fichiers exportés par l'ancienne application (clients-….csv et transactions-….csv). Les clients sont créés, leur historique importé, puis chaque solde est aligné sur la colonne Solde de la sauvegarde.",
  },
  customers: {
    label: "Clients",
    mutation: api.imports.importCustomers,
    note: "Chaque ligne crée un prospect dans votre agence. Un téléphone déjà enregistré est ignoré, donc réimporter le même fichier ne crée pas de doublon.",
  },
  transactions: {
    label: "Transactions",
    mutation: api.imports.importTransactions,
    note: "Historique de dépôts et retraits de clients déjà enregistrés, retrouvés par téléphone ou n° de compte. Ces lignes comptent dans le solde du client mais jamais dans la caisse d'un agent. Sans colonne Type, un montant négatif est un retrait.",
  },
}

/**
 * "Importer" button that opens the import wizard in a dialog. Shown only to
 * staff with data:import; `kind` is the tab the wizard opens on.
 */
export function ImportButton({ kind = "backup", label = "Importer" }) {
  const me = useQuery(api.users.me)
  const [open, setOpen] = useState(false)
  if (!me?.can?.importData) return null
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}><I.ArrowDown size={14}/>{label}</button>
      {open && <ImportDialog initialKind={kind} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * Import customers, past transactions or an old-app backup from an .xlsx or
 * .csv file into the caller's branch, as a modal wizard. It can't be closed
 * while rows are being sent.
 */
export default function ImportDialog({ initialKind = "backup", onClose }) {
  const [kind, setKind] = useState(initialKind)
  const [file, setFile] = useState(null)           // { name, headers, data }
  const [mapping, setMapping] = useState({})
  const [readError, setReadError] = useState(null)
  const [run, setRun] = useState(null)             // { done, total, results, error, finished }
  const [backupBusy, setBackupBusy] = useState(false)
  const [step, setStep] = useState(0)               // index in STEPS
  const inputRef = useRef(null)
  const send = useMutation(KINDS[kind].mutation ?? api.imports.importCustomers)

  const items = useMemo(
    () => (file && kind !== "backup" ? buildItems(kind, file.data, mapping) : []),
    [file, kind, mapping],
  )
  const ready = items.filter((i) => i.payload)
  const invalid = items.filter((i) => i.error)
  const fields = FIELDS[kind] ?? []
  const missingRequired = fields.filter((f) => f.required && !(mapping[f.key] >= 0))
  const noCustomerColumn =
    kind === "transactions" && !(mapping.phoneNumber >= 0) && !(mapping.accountNumber >= 0) && !(mapping.legacyClientId >= 0)
  const mappingOk = missingRequired.length === 0 && !noCustomerColumn
  const canImport = ready.length > 0 && mappingOk && !run

  const reset = () => { setFile(null); setMapping({}); setRun(null); setReadError(null); setStep(0) }
  const switchKind = (k) => {
    setKind(k)
    reset()
  }

  const onPick = async (f) => {
    if (!f) return
    reset()
    try {
      const rows = await readRows(f)
      if (rows.length < 2) throw new Error("empty")
      const headers = rows[0].map((h) => String(h ?? "").trim())
      setFile({ name: f.name, headers, data: rows.slice(1) })
      setMapping(guessMapping(kind, headers))
      setStep(1)
    } catch {
      setReadError("Fichier illisible ou vide. Utilisez un fichier .xlsx ou .csv avec une ligne d'en-têtes.")
    }
  }

  const onImport = async () => {
    const payloads = ready.map((i) => i.payload)
    const results = invalid.map((i) => ({ row: i.row, status: "error", code: i.error }))
    setRun({ done: 0, total: payloads.length, results, finished: false })
    setStep(3)
    try {
      for (let i = 0; i < payloads.length; i += BATCH) {
        const chunk = payloads.slice(i, i + BATCH)
        results.push(...(await send({ rows: chunk })))
        setRun({ done: i + chunk.length, total: payloads.length, results: [...results], finished: false })
      }
      setRun((r) => ({ ...r, finished: true }))
    } catch (e) {
      // Earlier batches are saved; re-importing the file skips them
      setRun((r) => ({ ...r, finished: true, error: errorMessage(e) }))
    }
  }

  const labelOf = useMemo(() => new Map(items.map((i) => [i.row, i.label ?? ""])), [items])
  const report = run ? run.results.filter((r) => r.status !== "created").sort((a, b) => a.row - b.row) : []
  const previewPage = usePaged(items)
  const reportPage = usePaged(report)
  const created = run ? run.results.filter((r) => r.status === "created").length : 0
  const skipped = run ? run.results.filter((r) => r.status === "skipped").length : 0
  const errors = run ? run.results.filter((r) => r.status === "error").length : 0

  const downloadReport = () =>
    downloadText(
      `rapport-import-${kind}.csv`,
      toCsv([["Ligne", "Client", "Statut", "Motif"], ...report.map((r) => [
        r.row, labelOf.get(r.row), r.status === "skipped" ? "Ignorée" : "Erreur", REASONS[r.code] ?? r.code,
      ])]),
    )

  const running = !!run && !run.finished
  const busy = running || backupBusy

  // Native modal: focus is trapped inside and Esc closes it, unless busy
  const dialogRef = useRef(null)
  useEffect(() => { dialogRef.current?.showModal() }, [])
  const close = () => { if (!busy) onClose() }

  return (
    <dialog ref={dialogRef} className="modal" aria-labelledby="import-title"
      onCancel={(e) => { e.preventDefault(); close() }}>
      <div className="modal-head">
        <div id="import-title" className="modal-title">Importer des données</div>
        <button className="btn ghost sm" style={{ padding: 6 }} onClick={close} disabled={busy}
          aria-label="Fermer" title={busy ? "Import en cours" : "Fermer"}>✕</button>
      </div>
      <div className="modal-body">
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="seg">
            {Object.entries(KINDS).map(([k, v]) => (
              <button key={k} aria-pressed={kind === k} className={kind === k ? "on" : ""} onClick={() => switchKind(k)} disabled={busy}>{v.label}</button>
            ))}
          </div>
          <div className="filter-spacer"/>
          {TEMPLATES[kind] && (
            <button className="btn sm" onClick={() => downloadText(`modele-${kind}.csv`, toCsv(TEMPLATES[kind]))}>
              <I.Export size={14}/>Modèle CSV
            </button>
          )}
        </div>
        <p className="cell-sub" style={{ fontSize: 13, margin: 0, padding: "0 16px 16px", maxWidth: 760 }}>{KINDS[kind].note}</p>
      </div>

      {kind === "backup" ? <BackupImport onBusy={setBackupBusy}/> : (
        <div className="card">
          <WizardSteps steps={STEPS} current={step}/>

          {step === 0 && <>
            <div className="wiz-body">
              <div className="upload">
                <I.Folder size={20}/>
                <div>
                  <div style={{ fontWeight: 550, fontSize: 13 }}>{file ? file.name : "Aucun fichier choisi"}</div>
                  <div className="cell-sub">
                    {file ? `${file.data.length} ligne${file.data.length > 1 ? "s" : ""} · ${file.headers.length} colonnes` : ".xlsx (1ʳᵉ feuille) ou .csv, en-têtes sur la première ligne"}
                  </div>
                </div>
                <input ref={inputRef} type="file" accept=".xlsx,.csv,.txt" hidden
                  onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = "" }}/>
                <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => inputRef.current?.click()}>
                  {file ? "Changer…" : "Choisir…"}
                </button>
              </div>
              {readError && <div style={{ color: "var(--neg)", fontSize: 13, marginTop: 10 }}>{readError}</div>}
            </div>
            <WizardFoot>
              <button className="btn brand" disabled={!file} onClick={() => setStep(1)}>Suivant ›</button>
            </WizardFoot>
          </>}

          {step === 1 && file && <>
            <div className="wiz-body">
              <div className="cell-sub" style={{ fontSize: 13, marginBottom: 12 }}>
                Indiquez quelle colonne de <strong>{file.name}</strong> contient chaque information. Les colonnes reconnues sont déjà choisies.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                {fields.map((f) => (
                  <label key={f.key} className="field">
                    <span className="field-label">{f.label}{f.required && " *"}</span>
                    <select className="input" value={mapping[f.key] ?? -1}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}>
                      <option value={-1}>— Aucune —</option>
                      {file.headers.map((h, i) => <option key={i} value={i}>{h || `Colonne ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {!mappingOk && (
                <div style={{ color: "var(--neg)", fontSize: 13, marginTop: 12 }}>
                  {missingRequired.length > 0 && `Colonne obligatoire manquante : ${missingRequired.map((f) => f.label).join(", ")}. `}
                  {noCustomerColumn && "Choisissez la colonne ID client, Téléphone ou N° de compte pour retrouver le client."}
                </div>
              )}
            </div>
            <WizardFoot onBack={() => setStep(0)}>
              <button className="btn brand" disabled={!mappingOk} onClick={() => setStep(2)}>Suivant ›</button>
            </WizardFoot>
          </>}

          {step === 2 && file && <>
            <div className="wiz-body" style={{ paddingBottom: 0, fontSize: 13 }}>
              <strong>{ready.length}</strong> ligne{ready.length > 1 ? "s" : ""} prête{ready.length > 1 ? "s" : ""}
              {invalid.length > 0 && <span style={{ color: "var(--neg)" }}> · <strong>{invalid.length}</strong> en erreur, elles ne seront pas importées</span>}
            </div>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table className="data-table">
                <thead><tr><th>Ligne</th>{kind === "customers"
                  ? <><th>Nom</th><th>Téléphone</th><th>Groupe</th><th>N° compte</th></>
                  : <><th>Client</th><th>Type</th><th style={{ textAlign: "right" }}>Montant</th><th>Date</th><th>Agent</th></>}
                  <th>Statut</th></tr></thead>
                <tbody>
                  {previewPage.rows.map((it) => {
                    const p = it.payload ?? {}
                    return (
                      <tr key={it.row}>
                        <td className="cell-sub">{it.row}</td>
                        {kind === "customers"
                          ? <><td>{p.fullName ?? it.label ?? "—"}</td><td>{p.phoneNumber ?? "—"}</td><td>{p.groupName ?? "—"}</td><td>{p.accountNumber ?? "—"}</td></>
                          : <><td>{it.label || "—"}</td><td>{p.type ? (p.type === "deposit" ? "Dépôt" : "Retrait") : "—"}</td>
                              <td style={{ textAlign: "right" }}>{p.amount ? fmt(p.amount) : "—"}</td>
                              <td>{p.date ? new Date(p.date).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—"}</td>
                              <td>{p.agentName ?? "—"}</td></>}
                        <td>{it.error
                          ? <span className="tag archive" style={{ color: "var(--neg)" }}>{REASONS[it.error] ?? it.error}</span>
                          : <span className="tag actif">Prête</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pager paged={previewPage}/>
            <WizardFoot onBack={() => setStep(1)}>
              <button className="btn brand" disabled={!canImport} onClick={onImport}>
                <I.ArrowDown size={14} stroke="white"/>Importer {ready.length} ligne{ready.length > 1 ? "s" : ""}
              </button>
            </WizardFoot>
          </>}

          {step === 3 && run && <>
            <div className="wiz-body">
              <div style={{ fontWeight: 550, fontSize: 13, marginBottom: 8 }}>
                {run.finished ? "Import terminé" : `Import en cours… ${run.done} / ${run.total}`}
              </div>
              <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", width: `${run.total ? (100 * run.done) / run.total : 100}%`, background: "var(--brand)" }}/>
              </div>
              <div style={{ display: "flex", gap: 20, fontSize: 13, flexWrap: "wrap" }}>
                <span><strong>{created}</strong> {kind === "customers" ? "client(s) créé(s)" : "transaction(s) importée(s)"}</span>
                <span><strong>{skipped}</strong> ignorée(s)</span>
                <span style={{ color: errors ? "var(--neg)" : undefined }}><strong>{errors}</strong> en erreur</span>
              </div>
              {run.error && (
                <div role="alert" style={{ color: "var(--neg)", fontSize: 13, marginTop: 10 }}>
                  Import interrompu : {run.error} Les lignes déjà importées sont enregistrées ; relancez le même fichier pour continuer.
                </div>
              )}
            </div>
            {run.finished && report.length > 0 && <>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead><tr><th>Ligne</th><th>Client</th><th>Statut</th><th>Motif</th></tr></thead>
                  <tbody>
                    {reportPage.rows.map((r) => (
                      <tr key={r.row}>
                        <td className="cell-sub">{r.row}</td>
                        <td>{labelOf.get(r.row) || "—"}</td>
                        <td><span className={"tag " + (r.status === "skipped" ? "attente" : "archive")}>{r.status === "skipped" ? "Ignorée" : "Erreur"}</span></td>
                        <td>{REASONS[r.code] ?? r.code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager paged={reportPage}/>
            </>}
            {run.finished && (
              <WizardFoot>
                {report.length > 0 && <button className="btn" onClick={downloadReport}><I.Export size={14}/>Rapport CSV</button>}
                <button className="btn brand" onClick={reset}>Nouvel import</button>
              </WizardFoot>
            )}
          </>}
        </div>
      )}
      </div>
    </dialog>
  )
}
