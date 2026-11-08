import { useState, useMemo } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { I } from '../icons'
import Novu from '../components/Inbox'
import { errorMessage, fmt, fmtDateTime, fmtDuration, initials, mapUrl, KpiSkeleton, TableSkeleton, PageHeader, SearchInput } from '../components'
import { Pager, usePaged } from '../components/Pager'
import { ImportButton } from '../components/ImportDialog'
import { useDialog } from '../components/useDialog'

const PERIODS = { "24h": 1, "7j": 7, "30j": 30, "Tout": null }

const STATUS_STYLE = {
  "validée":    { cls: "actif",   label: "Validée"    },
  "en attente": { cls: "attente", label: "En attente" },
  "annulée":    { cls: "archive", label: "Annulée"    },
}

// Synced this long after it was recorded on the TPE: worth a look
const LATE_SYNC_MS = 6 * 3600 * 1000

/** When the agent recorded it on the TPE, if that differs from when the server got it. */
function RecordedAt({ tx }) {
  const gap = tx.timestamp - tx.recordedAt
  if (Math.abs(gap) < 10 * 60 * 1000) return <>{fmtDateTime(tx.recordedAt)}</>
  // The phone claims a time after the server received it: its clock is ahead
  if (gap < 0) {
    return <span style={{ color: "var(--neg)" }}>{fmtDateTime(tx.recordedAt)} · horloge du TPE en avance de {fmtDuration(gap)}</span>
  }
  return (
    <span style={gap > LATE_SYNC_MS ? { color: "var(--neg)", fontWeight: 550 } : undefined}>
      {fmtDateTime(tx.recordedAt)} · reçue {fmtDuration(gap)} plus tard
    </span>
  )
}

/** Movement detail drawer. Approve and reverse actions only show when `can` allows them. */
function TxDrawer({ tx, onClose, can }) {
  const st = STATUS_STYLE[tx.status]
  const reverse = useMutation(api.transactions.reverseTransaction)
  const approve = useMutation(api.disbursements.approveDisbursement)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [reversing, setReversing] = useState(false)
  const [reason, setReason] = useState("")

  const run = async (fn) => {
    setBusy(true); setError(null)
    try { await fn(); onClose() }
    catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }
  const onReverse = () => run(() => reverse({ transactionId: tx.id, reason: reason.trim() }))
  const canApprove = can.approve && tx.kind === "disbursement" && tx.status === "en attente"
  const canReverse = can.reverse && tx.kind === "transaction" && tx.status === "validée"
  const onApprove = () => run(() => approve({ disbursementId: tx.id }))
  const ref = useDialog(onClose)
  return (
    <>
      <div className="drawer-scrim" onClick={onClose}/>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${tx.label} — ${tx.client}`} ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{tx.id}</div>
            <div style={{ fontWeight: 600, fontSize: 18, letterSpacing: "-0.015em", marginTop: 2 }}>{tx.label} — {tx.client}</div>
            <div className="cell-sub" style={{ marginTop: 2 }}>{fmtDateTime(tx.timestamp)} · {tx.agent}</div>
          </div>
          <button className="btn ghost sm" onClick={onClose} style={{ padding: 6 }} aria-label="Fermer">✕</button>
        </div>
        <div className="drawer-body">
          <div style={{
            padding: 18, borderRadius: 12,
            background: tx.type === "in" ? "var(--pos-soft)" : "var(--neg-soft)",
            display: "flex", alignItems: "center", gap: 14,
          }}>
            <span className={"tx-icon " + tx.type} style={{ width: 40, height: 40 }}>
              {tx.type === "in" ? <I.ArrowDown size={20}/> : <I.ArrowUp size={20}/>}
            </span>
            <div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 500 }}>Montant</div>
              <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.025em", fontVariantNumeric: "tabular-nums",
                            color: tx.type === "in" ? "var(--pos)" : "var(--neg)" }}>
                {tx.type === "in" ? "+" : "−"}{fmt(tx.amount)}<span style={{ fontSize: 13, marginLeft: 6, fontWeight: 500 }}>FCFA</span>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <div className="card-title" style={{ marginBottom: 10 }}>Détails</div>
            <dl className="info-list">
              <dt>Statut</dt><dd><span className={"tag " + st.cls}>{st.label}</span></dd>
              <dt>Agence</dt><dd>{tx.branch}</dd>
              <dt>Canal</dt><dd>{tx.channel}</dd>
              <dt>Terminal</dt><dd style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{tx.tpe}</dd>
              {tx.recordedAt && <><dt>Saisie sur le TPE</dt><dd><RecordedAt tx={tx}/></dd></>}
              {tx.location && (
                <><dt>Position</dt><dd>
                  <a href={mapUrl(tx.location)} target="_blank" rel="noreferrer">Voir sur la carte</a>
                  {tx.location.accuracy !== undefined && <span className="cell-sub"> · ±{tx.location.accuracy} m</span>}
                  {tx.location.mocked && <div style={{ color: "var(--neg)", fontWeight: 550 }}>Position simulée (faux GPS)</div>}
                </dd></>
              )}
              <dt>Agent</dt><dd>{tx.agent}</dd>
              <dt>Client</dt><dd>{tx.client}</dd>
              {tx.reason && <><dt>Motif annulation</dt><dd>{tx.reason}</dd></>}
              {tx.overdraft && <><dt>Alerte</dt><dd style={{ color: "var(--neg)" }}>Retrait hors ligne supérieur au solde du client : à régulariser.</dd></>}
              {tx.reversedBy && <><dt>Annulée par</dt><dd>{tx.reversedBy}</dd></>}
            </dl>
          </div>

          {reversing && (
            <div className="drawer-section">
              <label className="field">
                <span className="field-label">Motif de l'annulation</span>
                <textarea className="input" rows={3} autoFocus value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Ex. erreur de montant saisi" />
              </label>
              <div className="cell-sub" style={{ marginTop: 6 }}>L'annulation est définitive et tracée à votre nom.</div>
            </div>
          )}
          {error && (
            <div className="drawer-section" role="alert" style={{ color: "var(--neg)", fontSize: 13 }}>{error}</div>
          )}
        </div>
        <div className="drawer-foot">
          <button className="btn"><I.Export size={14}/>Reçu PDF</button>
          {canApprove && <button className="btn brand" style={{ marginLeft: "auto" }} disabled={busy} onClick={onApprove}><I.Check size={14} stroke="white"/>Approuver</button>}
          {canReverse && !reversing && <button className="btn" style={{ marginLeft: "auto", color: "var(--neg)" }} onClick={() => setReversing(true)}>Annuler la transaction</button>}
          {canReverse && reversing && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="btn" disabled={busy} onClick={() => { setReversing(false); setReason("") }}>Retour</button>
              <button className="btn" style={{ color: "var(--neg)" }} disabled={busy || !reason.trim()} onClick={onReverse}>Confirmer l'annulation</button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

/** Movements list with period, type, channel and agent filters, search, totals and the detail drawer. */
export default function TransactionsPage() {
  const [q, setQ] = useState("")
  const [seg, setSeg] = useState("tous")
  const [channel, setChannel] = useState("tous")
  const [agent, setAgent] = useState("tous")
  const [period, setPeriod] = useState("7j")
  const [selected, setSelected] = useState(null)
  const me  = useQuery(api.users.me)
  const can = me?.can ?? {}

  // Round the window start to the hour so the query args stay stable between renders
  const since = useMemo(() => {
    const days = PERIODS[period]
    if (!days) return undefined
    return Math.floor((Date.now() - days * 86_400_000) / 3_600_000) * 3_600_000
  }, [period])
  const rows = useQuery(api.admin.listMovements, { since })
  const TX_FULL = rows ?? []

  const agents   = useMemo(() => ["tous", ...Array.from(new Set(TX_FULL.map(t => t.agent)))], [rows])
  const channels = useMemo(() => ["tous", ...Array.from(new Set(TX_FULL.map(t => t.channel)))], [rows])

  const filtered = useMemo(() => TX_FULL.filter(t => {
    if (seg === "in"      && t.type !== "in")           return false
    if (seg === "out"     && t.type !== "out")          return false
    if (seg === "pending" && t.status !== "en attente") return false
    if (channel !== "tous" && t.channel !== channel)    return false
    if (agent   !== "tous" && t.agent   !== agent)      return false
    if (q) {
      const blob = (t.client + " " + t.id + " " + t.tpe).toLowerCase()
      if (!blob.includes(q.toLowerCase())) return false
    }
    return true
  }), [rows, q, seg, channel, agent])

  const paged = usePaged(filtered)
  const totalIn  = filtered.filter(t => t.type === "in"  && t.status === "validée").reduce((s, t) => s + t.amount, 0)
  const totalOut = filtered.filter(t => t.type === "out" && t.status === "validée").reduce((s, t) => s + t.amount, 0)
  const net = totalIn - totalOut

  const counts = {
    tous:    TX_FULL.length,
    in:      TX_FULL.filter(t => t.type === "in").length,
    out:     TX_FULL.filter(t => t.type === "out").length,
    pending: TX_FULL.filter(t => t.status === "en attente").length,
  }

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const todayRows = TX_FULL.filter(t => t.timestamp >= dayStart.getTime() && t.status === "validée")
  const sumOf = (xs) => xs.reduce((s, t) => s + t.amount, 0)
  const ins  = TX_FULL.filter(t => t.type === "in"  && t.status === "validée")
  const outs = TX_FULL.filter(t => t.type === "out" && t.status === "validée")
  const TX_KPIS = [
    { label: "Volume du jour", value: fmt(sumOf(todayRows)), unit: "FCFA", note: `${todayRows.length} mouvement${todayRows.length > 1 ? "s" : ""}`, icon: "wallet" },
    { label: "Dépôts",         value: String(ins.length),    unit: "",     note: `${fmt(sumOf(ins))} FCFA`,  icon: "receipt" },
    { label: "Décaissements",  value: String(outs.length),   unit: "",     note: `${fmt(sumOf(outs))} FCFA`, icon: "receipt" },
    { label: "En attente",     value: String(counts.pending), unit: "",    note: "Approbation requise",     icon: "cloud" },
  ]

  return (
    <div className="tx-page">
      <PageHeader
        crumbs={["Transactions"]}
        title="Transactions"
      >
        <ImportButton kind="transactions" />
        <Novu />
      </PageHeader>

      {rows === undefined ? <KpiSkeleton /> : (
        <section className="kpi-row">
          {TX_KPIS.map(k => (
            <div className="kpi" key={k.label}>
              <div className="kpi-label">
                {k.icon === "wallet"  && <I.Wallet/>}
                {k.icon === "receipt" && <I.Receipt/>}
                {k.icon === "cloud"   && <I.Cloud/>}
                {k.label}
              </div>
              <div className="kpi-value">{k.value}{k.unit && <span className="unit">{k.unit}</span>}</div>
              <div className="kpi-foot">
                <span>{k.note}</span>
              </div>
            </div>
          ))}
        </section>
      )}
      
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <SearchInput placeholder="Client, ID, TPE…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="seg">
          {["24h","7j","30j","Tout"].map(p => (
            <button key={p} aria-pressed={period === p} className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>{p}</button>
          ))}
        </div>
        <button className="btn"><I.Export size={14}/>Exporter CSV</button>
        </div>
      <div className="card">
        <div className="filter-bar">
          <div className="seg-tabs">
            {[
              { k: "tous",    label: "Tous",       n: counts.tous },
              { k: "in",      label: "Dépôts",     n: counts.in },
              { k: "out",     label: "Décaissements", n: counts.out },
              { k: "pending", label: "En attente", n: counts.pending },
            ].map(t => (
              <button key={t.k} aria-pressed={seg === t.k} className={"seg-tab " + (seg === t.k ? "on" : "")} onClick={() => setSeg(t.k)}>
                {t.label}<span className="seg-count">{t.n}</span>
              </button>
            ))}
          </div>
          <div className="filter-spacer"/>
          <label className="filter-group">
            <span className="filter-label">Canal</span>
            <select className="filter-select" value={channel} onChange={e => setChannel(e.target.value)}>
              {channels.map(c => <option key={c} value={c}>{c === "tous" ? "Tous" : c}</option>)}
            </select>
          </label>
          <label className="filter-group">
            <span className="filter-label">Agent</span>
            <select className="filter-select" value={agent} onChange={e => setAgent(e.target.value)}>
              {agents.map(a => <option key={a} value={a}>{a === "tous" ? "Tous" : a}</option>)}
            </select>
          </label>
        </div>

        <div className="bulk-bar" style={{ background: "var(--surface-2)" }}>
          <span style={{ color: "var(--ink-3)" }}>Total filtré</span>
          <span style={{ color: "var(--pos)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>+{fmt(totalIn)} FCFA</span>
          <span style={{ color: "var(--neg)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>−{fmt(totalOut)} FCFA</span>
          <span style={{ color: "var(--ink-3)" }}>·</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>Net {net >= 0 ? "+" : "−"}{fmt(Math.abs(net))} FCFA</span>
          <div style={{ flex: 1 }}/>
          <span style={{ color: "var(--ink-3)" }}>{filtered.length} mouvement{filtered.length > 1 ? "s" : ""}</span>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Client</th>
                <th>Type</th>
                <th>Date / heure</th>
                <th>Canal · TPE</th>
                <th>Agent</th>
                <th style={{ textAlign: "right" }}>Montant</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map(t => {
                const st = STATUS_STYLE[t.status]
                return (
                  <tr key={t.id} onClick={() => setSelected(t)} className={selected && selected.id === t.id ? "selected" : ""}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-2)" }}>{t.id.slice(-8).toUpperCase()}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="avatar sm">{initials(t.client)}</div>
                        <div>
                          <div style={{ fontWeight: 550 }}>{t.client}</div>
                          <div className="cell-sub">{t.branch}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <span className={"tx-icon " + t.type} style={{ width: 22, height: 22 }}>
                          {t.type === "in" ? <I.ArrowDown size={11}/> : <I.ArrowUp size={11}/>}
                        </span>
                        {t.label}
                      </span>
                    </td>
                    <td className="cell-sub">{fmtDateTime(t.timestamp)}</td>
                    <td>
                      <div>{t.channel}</div>
                      <div className="cell-sub" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{t.tpe}</div>
                    </td>
                    <td className="cell-sub">{t.agent}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600,
                                 color: t.type === "in" ? "var(--pos)" : "var(--neg)" }}>
                      {t.type === "in" ? "+" : "−"}{fmt(t.amount)}
                      <span className="cell-sub" style={{ marginLeft: 4, fontWeight: 400 }}>FCFA</span>
                    </td>
                    <td><span className={"tag " + st.cls}>{st.label}</span></td>
                    <td><button className="btn ghost sm" style={{ padding: 4 }} aria-label={`Détails de la transaction ${t.id}`} onClick={e => { e.stopPropagation(); setSelected(t) }}><I.Arrow size={12}/></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows === undefined && <TableSkeleton rows={6} label="Chargement des mouvements…" />}
          {rows !== undefined && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
              Aucun mouvement ne correspond aux filtres.
            </div>
          )}
          <Pager paged={paged} unit="mouvements" />
        </div>
      </div>

      {selected && <TxDrawer key={selected.id} tx={selected} can={can} onClose={() => setSelected(null)}/>}
    </div>
  )
}
