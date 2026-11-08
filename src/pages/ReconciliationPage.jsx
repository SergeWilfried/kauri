import { useState, useMemo } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { I } from '../icons'
import { errorMessage, fmt, initials, PageHeader, PageSkeleton } from '../components'
import { Pager, usePaged } from '../components/Pager'
import LedgerCard from '../components/LedgerCard'

// ─── Constants ────────────────────────────────────────────────────────────────

const DENOMS = [
  { v: 10000, kind: "billet", color: "oklch(0.78 0.10 30)" },
  { v: 5000,  kind: "billet", color: "oklch(0.78 0.10 145)" },
  { v: 2000,  kind: "billet", color: "oklch(0.78 0.10 240)" },
  { v: 1000,  kind: "billet", color: "oklch(0.78 0.08 60)"  },
  { v: 500,   kind: "billet", color: "oklch(0.82 0.06 290)" },
  { v: 500,   kind: "pièce",  color: "oklch(0.82 0.02 80)"  },
  { v: 250,   kind: "pièce",  color: "oklch(0.82 0.02 80)"  },
  { v: 200,   kind: "pièce",  color: "oklch(0.82 0.02 80)"  },
  { v: 100,   kind: "pièce",  color: "oklch(0.82 0.02 80)"  },
  { v: 50,    kind: "pièce",  color: "oklch(0.82 0.02 80)"  },
  { v: 25,    kind: "pièce",  color: "oklch(0.82 0.02 80)"  },
  { v: 10,    kind: "pièce",  color: "oklch(0.82 0.02 80)"  },
  { v: 5,     kind: "pièce",  color: "oklch(0.82 0.02 80)"  },
]

const STATUS_META = {
  "en cours":     { label: "En cours",     cls: "rec-status open"     },
  "écart":        { label: "Écart",        cls: "rec-status variance" },
  "écart résolu": { label: "Écart résolu", cls: "rec-status resolved" },
  "signée":       { label: "Signée",       cls: "rec-status signed"   },
}

// ─── Mapping from Convex rows ─────────────────────────────────────────────────

const STATUS_FROM_DB = { pending: "en cours", settled: "signée", discrepancy: "écart" }

/** HH:MM in French locale. */
const hhmm = (ts) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
/** "14 octobre 2026" from an ISO date. */
const longDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
/** "14/10" from an ISO date. */
const shortDate = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7)
/** Ledger with the whole amount in cash (other channels aren't tracked yet). */
const ledger = (cash) => ({ cash, om: 0, moov: 0, bank: 0 })

/** View model for a recorded reconciliation. */
function fromReconciliation(r) {
  return {
    id: r.id, agentId: r.agentId, timestamp: r.timestamp,
    date: longDate(r.date), dateShort: shortDate(r.date),
    agent: r.agent, agentInit: initials(r.agent), drawer: `Caisse · ${r.tpe}`,
    opened: "—", closed: hhmm(r.timestamp),
    status: STATUS_FROM_DB[r.status],
    txCount: r.txCount,
    expected: ledger(r.expected),
    counted:  ledger(r.counted),
    notes: r.notes,
    signedBy: r.status === "settled" ? r.verifiedBy : null,
    signedAt: r.status === "settled" ? hhmm(r.timestamp) : null,
    verifiedBy: r.verifiedBy,
  }
}

/** View model for an agent's open, not yet reconciled day. */
function fromOpenSession(o) {
  return {
    id: `open-${o.agentId}`, agentId: o.agentId, timestamp: o.opened,
    date: longDate(o.date), dateShort: shortDate(o.date),
    agent: o.agent, agentInit: initials(o.agent), drawer: `Caisse · ${o.tpe}`,
    opened: hhmm(o.opened), closed: null,
    status: "en cours",
    txCount: o.txCount,
    expected: ledger(o.expected),
    counted:  ledger(0),
    notes: "",
  }
}

const PERIOD_DAYS = { "24h": 1, "7j": 7, "30j": 30, "Tout": null }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Total across all ledger channels. */
function sumLedger(l) { return (l.cash || 0) + (l.om || 0) + (l.moov || 0) + (l.bank || 0) }

/** Counted minus expected, per channel and in total. */
function varianceOf(r) {
  return {
    cash:  r.counted.cash  - r.expected.cash,
    om:    r.counted.om    - r.expected.om,
    moov:  r.counted.moov  - r.expected.moov,
    bank:  r.counted.bank  - r.expected.bank,
    total: sumLedger(r.counted) - sumLedger(r.expected),
  }
}

/** Greedy split of an amount into FCFA notes and coins, to prefill the cash count. */
function reverseEngineer(total) {
  const out = {}
  let r = total
  const order = [10000, 5000, 2000, 1000, 500, 250, 200, 100, 50, 25, 10, 5]
  for (const v of order) {
    const kind = v >= 1000 ? "billet" : (v === 500 ? "billet" : "pièce")
    const key = `${kind}-${v}`
    const n = Math.floor(r / v)
    if (n > 0) { out[key] = (out[key] || 0) + n; r -= n * v }
  }
  return out
}

// ─── Page entry ───────────────────────────────────────────────────────────────

/** Merge open days with recorded reconciliations; show the list or the selected one's detail. */
export default function ReconciliationPage() {
  const [selectedId, setSelectedId] = useState(null)
  const recs = useQuery(api.admin.listReconciliations)
  const open = useQuery(api.admin.openSessions)

  const records = useMemo(() => {
    if (recs === undefined || open === undefined) return undefined
    return [...open.map(fromOpenSession), ...recs.map(fromReconciliation)]
  }, [recs, open])

  if (records === undefined) {
    return (
      <div className="recon-page">
        <PageHeader crumbs={["Réconciliation"]} title="Réconciliation de caisse" />
        <PageSkeleton />
      </div>
    )
  }
  const selected = records.find(r => r.id === selectedId)

  if (selected) {
    return <ReconciliationDetail record={selected} onBack={() => setSelectedId(null)} onDone={setSelectedId} />
  }
  return <ReconciliationIndex records={records} onOpen={setSelectedId} />
}

// ─── Index list ───────────────────────────────────────────────────────────────

/** Reconciliation list with status, agent and period filters and search. */
function ReconciliationIndex({ records: RECON_RECORDS, onOpen }) {
  const [seg, setSeg]       = useState("tous")
  const [agent, setAgent]   = useState("tous")
  const [period, setPeriod] = useState("7j")
  const [q, setQ]           = useState("")

  const agents = useMemo(() => ["tous", ...Array.from(new Set(RECON_RECORDS.map(r => r.agent)))], [RECON_RECORDS])

  const filtered = useMemo(() => RECON_RECORDS.filter(r => {
    const days = PERIOD_DAYS[period]
    if (days && r.timestamp < Date.now() - days * 86_400_000) return false
    if (seg === "ouverts" && r.status !== "en cours") return false
    if (seg === "ecarts"  && !(r.status === "écart" || r.status === "écart résolu")) return false
    if (seg === "signes"  && r.status !== "signée") return false
    if (agent !== "tous"  && r.agent !== agent) return false
    if (q) {
      const blob = (r.id + " " + r.agent + " " + r.drawer + " " + r.notes).toLowerCase()
      if (!blob.includes(q.toLowerCase())) return false
    }
    return true
  }), [RECON_RECORDS, period, seg, agent, q])
  const paged = usePaged(filtered)

  const counts = {
    tous:    RECON_RECORDS.length,
    ouverts: RECON_RECORDS.filter(r => r.status === "en cours").length,
    ecarts:  RECON_RECORDS.filter(r => r.status === "écart" || r.status === "écart résolu").length,
    signes:  RECON_RECORDS.filter(r => r.status === "signée").length,
  }

  const weekAgo          = Date.now() - 7 * 86_400_000
  const closedWeek       = RECON_RECORDS.filter(r => r.status !== "en cours" && r.timestamp >= weekAgo)
  const totalVarianceAbs = closedWeek.reduce((s, r) => s + Math.abs(varianceOf(r).total), 0)
  const openCount        = counts.ouverts
  const varianceCount    = RECON_RECORDS.filter(r => r.status === "écart").length
  const signedThisWeek   = closedWeek.filter(r => r.status === "signée").length
  const openSessions     = RECON_RECORDS.filter(r => r.status === "en cours")

  const kpis = [
    { label: "Sessions ouvertes",  value: String(openCount),      note: openCount === 1 ? "1 agent à liquider" : `${openCount} agents à liquider`, icon: "wallet" },
    { label: "Écarts",             value: String(varianceCount),  note: "Enregistrés avec écart", icon: "alert" },
    { label: "Écart cumulé (7 j)", value: fmt(totalVarianceAbs), unit: "FCFA", note: "Tous postes confondus", icon: "coin" },
    { label: "Signées (7 j)",      value: String(signedThisWeek), note: `Sur ${closedWeek.length} session${closedWeek.length > 1 ? "s" : ""}`, icon: "check" },
  ]

  return (
    <div className="recon-page">
      <PageHeader crumbs={["Réconciliation"]} title="Réconciliation de caisse">
        <button className="btn"><I.Export size={14}/>Exporter</button>
      </PageHeader>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginBottom: 18 }}>
        <div className="search" style={{ width: 240 }}>
          <I.Search /><input placeholder="ID, agent, caisse…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="seg">
          {["24h","7j","30j","Tout"].map(p => (
            <button key={p} aria-pressed={period === p} className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>{p}</button>
          ))}
        </div>
      </div>

      <section className="kpi-row">
        {kpis.map(k => (
          <div className="kpi" key={k.label}>
            <div className="kpi-label">
              {k.icon === "wallet" && <I.Wallet/>}
              {k.icon === "coin"   && <I.Coin/>}
              {k.icon === "check"  && <I.Check/>}
              {k.icon === "alert"  && <I.Bell/>}
              {k.label}
            </div>
            <div className="kpi-value">{k.value}{k.unit && <span className="unit"> {k.unit}</span>}</div>
            <div className="kpi-foot">
              <span>{k.note}</span>
            </div>
          </div>
        ))}
      </section>

      <LedgerCard />

      {openSessions.map(o => (
        <div className="recon-banner" key={o.id}>
          <div className="recon-banner-icon"><I.Wallet size={18}/></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Session du jour ouverte — {o.agent}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
              {o.drawer} · premier mouvement à {o.opened} · {o.txCount} mouvements · théorique {fmt(o.expected.cash)} FCFA
            </div>
          </div>
          <button className="btn" onClick={() => onOpen(o.id)}>Compter la caisse <I.Arrow size={12}/></button>
        </div>
      ))}

      <div className="card">
        <div className="filter-bar">
          <div className="seg-tabs">
            {[
              { k: "tous",    label: "Toutes",   n: counts.tous    },
              { k: "ouverts", label: "En cours", n: counts.ouverts },
              { k: "ecarts",  label: "Écarts",   n: counts.ecarts  },
              { k: "signes",  label: "Signées",  n: counts.signes  },
            ].map(t => (
              <button key={t.k} aria-pressed={seg === t.k} className={"seg-tab " + (seg === t.k ? "on" : "")} onClick={() => setSeg(t.k)}>
                {t.label}<span className="seg-count">{t.n}</span>
              </button>
            ))}
          </div>
          <div className="filter-spacer"/>
          <label className="filter-group">
            <span className="filter-label">Agent</span>
            <select className="filter-select" value={agent} onChange={e => setAgent(e.target.value)}>
              {agents.map(a => <option key={a} value={a}>{a === "tous" ? "Tous" : a}</option>)}
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Date</th>
                <th>Agent · Caisse</th>
                <th>Mvt</th>
                <th style={{ textAlign: "right" }}>Théorique</th>
                <th style={{ textAlign: "right" }}>Compté</th>
                <th style={{ textAlign: "right" }}>Écart</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map(r => {
                const v    = varianceOf(r)
                const meta = STATUS_META[r.status]
                const expectedTotal = sumLedger(r.expected)
                const countedTotal  = sumLedger(r.counted)
                return (
                  <tr key={r.id} onClick={() => onOpen(r.id)}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-2)" }}>{r.status === "en cours" ? "—" : r.id.slice(-8).toUpperCase()}</td>
                    <td>
                      <div>{r.date}</div>
                      <div className="cell-sub">{r.closed ? `clôturée ${r.closed}` : `ouverte ${r.opened}`}</div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="avatar sm">{r.agentInit}</div>
                        <div>
                          <div style={{ fontWeight: 550 }}>{r.agent}</div>
                          <div className="cell-sub">{r.drawer}</div>
                        </div>
                      </div>
                    </td>
                    <td className="cell-sub" style={{ fontVariantNumeric: "tabular-nums" }}>{r.txCount}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {fmt(expectedTotal)}<span className="cell-sub" style={{ marginLeft: 4 }}>FCFA</span>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {fmt(countedTotal)}<span className="cell-sub" style={{ marginLeft: 4 }}>FCFA</span>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600,
                                 color: v.total === 0 ? "var(--ink-3)" : v.total > 0 ? "var(--pos)" : "var(--neg)" }}>
                      {v.total === 0 ? "—" : (v.total > 0 ? "+" : "−") + fmt(Math.abs(v.total))}
                    </td>
                    <td><span className={meta.cls}><span className="rec-status-dot"/>{meta.label}</span></td>
                    <td>
                      <button className="btn ghost sm" style={{ padding: 4 }} aria-label={`Ouvrir la réconciliation de ${r.agent} du ${r.date}`}
                        onClick={e => { e.stopPropagation(); onOpen(r.id) }}>
                        <I.Arrow size={12}/>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
              Aucune réconciliation ne correspond aux filtres.
            </div>
          )}
          <Pager paged={paged} unit="sessions" />
        </div>
      </div>
    </div>
  )
}

// ─── Detail wizard ────────────────────────────────────────────────────────────

/**
 * Cash count and sign-off for one reconciliation. Only users with `liquidate` can close the drawer.
 */
function ReconciliationDetail({ record, onBack, onDone }) {
  const initialCounts = record.status === "en cours"
    ? {}
    : reverseEngineer(record.counted.cash)
  const settle = useMutation(api.reconciliation.settleDailyCash)
  const me = useQuery(api.users.me)
  const canSettle = !!me?.can?.liquidate
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  const [counts, setCounts] = useState(initialCounts)
  const [om,    setOM]      = useState(record.counted.om)
  const [moov,  setMoov]    = useState(record.counted.moov)
  const [bank,  setBank]    = useState(record.counted.bank)
  const [notes, setNotes]   = useState(record.notes || "")

  const cashCounted = useMemo(() =>
    DENOMS.reduce((s, d) => s + d.v * (counts[`${d.kind}-${d.v}`] || 0), 0),
    [counts]
  )

  const variance = {
    cash: cashCounted - record.expected.cash,
    om:   om          - record.expected.om,
    moov: moov        - record.expected.moov,
    bank: bank        - record.expected.bank,
  }
  variance.total = variance.cash + variance.om + variance.moov + variance.bank

  const meta      = STATUS_META[record.status]
  // Anything already persisted in Convex is read-only; only today's open session is editable
  const isClosed  = record.status !== "en cours"
  const totalCounted  = cashCounted + om + moov + bank
  const totalExpected = sumLedger(record.expected)

  const onSettle = async () => {
    setBusy(true); setError(null)
    try {
      const { reconciliationId } = await settle({ agentId: record.agentId, physicalAmount: totalCounted, notes: notes || undefined })
      onDone(reconciliationId)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const setDenom = (key, n) => {
    const next = Math.max(0, parseInt(n, 10) || 0)
    setCounts(prev => ({ ...prev, [key]: next }))
  }

  const stepStatus = (step) => {
    if (isClosed) return step <= 4 ? "done" : "todo"
    if (record.status === "écart") return step <= 2 ? "done" : step === 3 ? "active" : "todo"
    return step === 1 ? "done" : step === 2 ? "active" : "todo"
  }

  return (
    <div className="recon-page">
      <PageHeader crumbs={["Réconciliation", record.id]} title={null}>
        <button className="btn ghost sm" onClick={onBack}>← Toutes les sessions</button>
        <button className="btn"><I.Export size={14}/>Exporter PDF</button>
      </PageHeader>

      <div style={{ marginBottom: 14 }}>
        <h1 className="h1" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 2 }}>
          Session {record.dateShort} · {record.drawer.split(" · ")[0]}
          <span className={meta.cls} style={{ fontSize: 12 }}><span className="rec-status-dot"/>{meta.label}</span>
        </h1>
        <div className="h1-sub">
          {record.agent} · {record.drawer}
          {record.closed ? ` · clôturée à ${record.closed}` : ` · premier mouvement à ${record.opened}`}
          {" · "}{record.txCount} mouvements
        </div>
      </div>

      <div className="recon-meta">
        <div>
          <div className="recon-meta-l">Théorique (système)</div>
          <div className="recon-meta-v" style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmt(totalExpected)} <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}>FCFA</span>
          </div>
        </div>
        <div>
          <div className="recon-meta-l">Compté (physique)</div>
          <div className="recon-meta-v" style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmt(totalCounted)} <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}>FCFA</span>
          </div>
        </div>
        <div>
          <div className="recon-meta-l">Écart</div>
          <div className={"recon-meta-v " + (variance.total === 0 ? "variance-zero" : variance.total > 0 ? "variance-pos" : "variance-neg")}
               style={{ fontVariantNumeric: "tabular-nums" }}>
            {variance.total === 0 ? "—" : (variance.total > 0 ? "+" : "−") + fmt(Math.abs(variance.total))}
            {variance.total !== 0 && <span style={{ fontSize: 11, color: "currentColor", fontWeight: 500 }}> FCFA</span>}
          </div>
        </div>
        <div>
          <div className="recon-meta-l">{record.verifiedBy ? "Vérifiée par" : "Vérificateur"}</div>
          <div className="recon-meta-v">
            {record.verifiedBy
              ? <>{record.verifiedBy} <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}>· {record.closed}</span></>
              : <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>En attente</span>}
          </div>
        </div>
      </div>

      <div className="recon-detail">
        {/* LEFT — cash counter + other channels */}
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <div>
                <div className="card-title">Comptage des espèces</div>
                <div className="card-sub">Saisir le nombre d'unités par coupure</div>
              </div>
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Sous-total</div>
                <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.015em" }}>
                  {fmt(cashCounted)} <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}>FCFA</span>
                </div>
              </div>
            </div>
            <table className="denom-table">
              <thead>
                <tr>
                  <th>Coupure</th>
                  <th style={{ width: 100 }}>Type</th>
                  <th style={{ width: 130, textAlign: "center" }}>Nombre</th>
                  <th style={{ textAlign: "right", paddingRight: 16 }}>Sous-total</th>
                </tr>
              </thead>
              <tbody>
                {DENOMS.map(d => {
                  const key = `${d.kind}-${d.v}`
                  const n   = counts[key] || 0
                  const sub = d.v * n
                  return (
                    <tr key={key}>
                      <td>
                        <span className="denom-chip">
                          <span className="denom-swatch" style={{ background: d.color }}/>
                          {fmt(d.v)}
                        </span>
                      </td>
                      <td><span className="denom-kind">{d.kind}</span></td>
                      <td>
                        <div style={{ display: "flex", justifyContent: "center" }}>
                          <div className="denom-step">
                            <button onClick={() => setDenom(key, n - 1)} disabled={isClosed} aria-label={`Un ${d.kind} de ${fmt(d.v)} en moins`}>−</button>
                            <input type="text" value={n} onChange={e => setDenom(key, e.target.value)} disabled={isClosed} aria-label={`Nombre de ${d.kind}s de ${fmt(d.v)}`} inputMode="numeric"/>
                            <button onClick={() => setDenom(key, n + 1)} disabled={isClosed} aria-label={`Un ${d.kind} de ${fmt(d.v)} en plus`}>+</button>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: "right", paddingRight: 16 }}>
                        <span className="denom-sub" style={{ color: sub > 0 ? "var(--ink)" : "var(--ink-4)" }}>
                          {sub > 0 ? fmt(sub) : "—"}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Autres postes</div>
                <div className="card-sub">Mobile money et banque</div>
              </div>
            </div>
            <div>
              <LedgerLine color="oklch(0.66 0.16 30)"  glyph="OM" name="Orange Money"     sub="Solde portefeuille agent"
                expected={record.expected.om}   value={om}   onChange={setOM}   disabled={isClosed} />
              <LedgerLine color="oklch(0.62 0.14 240)" glyph="MV" name="Moov Money"       sub="Solde portefeuille agent"
                expected={record.expected.moov} value={moov} onChange={setMoov} disabled={isClosed} />
              <LedgerLine color="oklch(0.5 0.1 155)"   glyph={<I.Wallet size={14} stroke="white"/>} name="Versement banque" sub="Bordereau Coris Bank · J−1"
                expected={record.expected.bank} value={bank} onChange={setBank} disabled={isClosed} />
            </div>
          </div>
        </div>

        {/* RIGHT — variance + steps + notes */}
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="variance-hero">
              <div style={{ fontSize: 11, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Écart total</div>
              <div className={"variance-big " + (variance.total === 0 ? "variance-zero" : variance.total > 0 ? "variance-pos" : "variance-neg")}>
                {variance.total === 0 ? "Équilibrée" : (variance.total > 0 ? "+" : "−") + fmt(Math.abs(variance.total)) + " FCFA"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
                {variance.total === 0
                  ? "Aucun écart détecté entre théorique et physique."
                  : variance.total > 0
                    ? "Surplus en caisse — à investiguer (dépôt non saisi ?)."
                    : "Manque en caisse — à investiguer (retrait non saisi, billet manquant ?)."}
              </div>
            </div>
            <div className="variance-rows">
              <VarianceRow label="Espèces"      expected={record.expected.cash} counted={cashCounted} />
              <VarianceRow label="Orange Money" expected={record.expected.om}   counted={om}          />
              <VarianceRow label="Moov Money"   expected={record.expected.moov} counted={moov}        />
              <VarianceRow label="Banque"        expected={record.expected.bank} counted={bank}        />
            </div>
          </div>

          <div className="recon-side-card">
            <div className="card-head">
              <div>
                <div className="card-title">Procédure de clôture</div>
                <div className="card-sub">4 étapes</div>
              </div>
            </div>
            {[
              { n: 1, label: "Ouverture de session",    meta: record.closed ? record.agent : `${record.agent} · ${record.opened}` },
              { n: 2, label: "Comptage physique",        meta: stepStatus(2) === "done" ? `Soumis à ${record.closed || "en cours"}` : "Espèces, mobile money, banque" },
              { n: 3, label: "Validation de l'écart",   meta: variance.total === 0 ? "Aucun écart à justifier" : `Justifier ${fmt(Math.abs(variance.total))} FCFA` },
              { n: 4, label: "Signature",               meta: record.verifiedBy ? `${record.verifiedBy} · ${record.closed}` : "En attente" },
            ].map(s => (
              <div key={s.n} className={"recon-step " + stepStatus(s.n)}>
                <div className="recon-step-num">{stepStatus(s.n) === "done" ? "✓" : s.n}</div>
                <div>
                  <div className="recon-step-label">{s.label}</div>
                  <div className="recon-step-meta">{s.meta}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="recon-side-card">
            <div className="card-head">
              <div>
                <div className="card-title">Note de session</div>
                <div className="card-sub">Justification & commentaires</div>
              </div>
            </div>
            <div style={{ padding: "0 14px 14px" }}>
              <textarea className="recon-notes" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Décrire l'écart, joindre une pièce, etc." disabled={isClosed}/>
            </div>
            <div className="recon-foot">
              {isClosed ? (
                <>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Session {meta.label.toLowerCase()} — verrouillée</span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn"><I.Export size={14}/>Télécharger PV</button>
                  </div>
                </>
              ) : (
                <>
                  {error && <span role="alert" style={{ fontSize: 12, color: "var(--neg)" }}>{String(error)}</span>}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                    {canSettle ? (
                      <button className="btn brand" disabled={busy} onClick={onSettle}>
                        <I.Check size={14} stroke="white"/>
                        {variance.total === 0 ? "Clôturer la session" : "Soumettre l'écart"}
                      </button>
                    ) : (
                      <span className="cell-sub">Seul un comptable peut clôturer la caisse.</span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** One channel row of the count: expected vs counted amount. */
function LedgerLine({ color, glyph, name, sub, expected, value, onChange, disabled }) {
  const delta = value - expected
  return (
    <div className="ledger-line">
      {/* Channel brand mark (Orange Money, Moov…): the name follows as text */}
      <div className="ledger-icon" style={{ background: color }} aria-hidden="true">
        {typeof glyph === "string"
          ? <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.02em" }}>{glyph}</span>
          : glyph}
      </div>
      <div>
        <div className="ledger-name">{name}</div>
        <div className="ledger-sub">{sub}</div>
      </div>
      <div className="ledger-expected">
        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, color: "var(--ink-4)" }}>Théorique</div>
        <div style={{ marginTop: 2 }}>{fmt(expected)}</div>
      </div>
      <input className="ledger-input" type="text" inputMode="numeric" value={fmt(value)} aria-label={`${name} : montant compté`}
        onChange={e => { const n = parseInt(e.target.value.replace(/\D/g, ""), 10) || 0; onChange(n) }}
        disabled={disabled}/>
      <div className={"ledger-delta " + (delta === 0 ? "" : delta > 0 ? "variance-pos" : "variance-neg")}>
        {delta === 0
          ? <span style={{ color: "var(--ink-4)" }}>—</span>
          : (delta > 0 ? "+" : "−") + fmt(Math.abs(delta))}
      </div>
    </div>
  )
}

/** Expected, counted and variance for one line of the summary. */
function VarianceRow({ label, expected, counted }) {
  const delta = counted - expected
  return (
    <div className="variance-row">
      <span className="v-label">{label}</span>
      <span className="v-num muted">{fmt(expected)}</span>
      <span className="v-num">{fmt(counted)}</span>
      <span className={"v-delta " + (delta === 0 ? "" : delta > 0 ? "variance-pos" : "variance-neg")}>
        {delta === 0
          ? <span style={{ color: "var(--ink-4)" }}>—</span>
          : (delta > 0 ? "+" : "−") + fmt(Math.abs(delta))}
      </span>
    </div>
  )
}
