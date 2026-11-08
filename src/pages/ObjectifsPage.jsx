import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { I } from '../icons'
import { downloadCsv, errorMessage, fmt, initials, SortHead, keyActivate, KPI, PageHeader, PageSkeleton, SearchInput } from '../components'
import { Pager, usePaged } from '../components/Pager'
import Novu from '../components/Inbox'
import { useDialog } from '../components/useDialog'
import { confirmDialog } from '../components/ConfirmDialog'

const OBJ_STATUSES = {
  atteint:   { label: "Atteint",       dot: "var(--pos)" },
  enavance:  { label: "En avance",     dot: "var(--pos)" },
  surrythme: { label: "Sur le rythme", dot: "var(--warn)" },
  encours:   { label: "En cours",      dot: "var(--brand)" },
  enretard:  { label: "En retard",     dot: "var(--neg)" },
  enpause:   { label: "En pause",      dot: "oklch(0.7 0.02 70)" },
}

// Reasons offered when setting a goal; anything else typed is kept as is
const CATEGORY_COLORS = {
  "Scolarité":        "oklch(0.6 0.13 230)",
  "Logement":         "var(--brand)",
  "Pèlerinage":       "oklch(0.55 0.13 280)",
  "Mariage":          "oklch(0.6 0.13 340)",
  "Soudure agricole": "oklch(0.6 0.13 130)",
  "Commerce":         "oklch(0.62 0.12 60)",
  "Santé":            "oklch(0.6 0.12 190)",
  "Tontine":          "oklch(0.65 0.06 70)",
}
const CATEGORIES = Object.keys(CATEGORY_COLORS)
const NO_CATEGORY = "Sans motif"
const YEAR = 365 * 86_400_000

/** Colour of a goal category. */
function catColor(name) {
  return CATEGORY_COLORS[name] || "var(--ink-3)"
}

/** Display metadata for a goal's status. */
function statusOf(o) { return OBJ_STATUSES[o.status] }

const fmtDate = (ts) => new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })

/** Deadline as typed in a date input (yyyy-mm-dd), local time. */
const toInputDate = (ts) => {
  if (!ts) return ""
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Create or edit a client's goal: target, reason and deadline. */
function GoalEditor({ goal, candidates, onClose }) {
  const isNew = !goal
  const setGoal = useMutation(api.portfolio.setGoal)
  const removeGoal = useMutation(api.portfolio.removeGoal)
  const [customerId, setCustomerId] = useState(goal?.id ?? "")
  const [target, setTarget] = useState(goal ? String(goal.target) : "")
  const [category, setCategory] = useState(goal?.category ?? "")
  const [deadline, setDeadline] = useState(toInputDate(goal?.deadline))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const ref = useDialog(onClose)

  const run = async (fn) => {
    setBusy(true)
    setError("")
    try { await fn(); onClose() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const save = () => {
    const amount = parseInt(target.replace(/\s/g, ""), 10)
    if (!customerId) return setError("Choisissez un client.")
    if (!amount || amount <= 0) return setError("Indiquez le montant à atteindre.")
    run(() => setGoal({
      customerId,
      target: amount,
      category: category.trim() || null,
      // End of the chosen day, local time
      deadline: deadline ? new Date(deadline + "T23:59:59").getTime() : null,
    }))
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose}/>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={isNew ? "Nouvel objectif" : `Objectif de ${goal.client}`} ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{isNew ? "Nouvel objectif" : goal.client}</div>
            <div className="cell-sub">
              {isNew ? "Fixer un objectif d'épargne à un client" : `Épargne actuelle : ${fmt(goal.current)} FCFA`}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose} style={{ padding: 6 }} aria-label="Fermer">✕</button>
        </div>
        <div className="drawer-body">
          {isNew && (
            <label className="field">
              <span className="field-label">Client</span>
              <select className="input" value={customerId} onChange={e => setCustomerId(e.target.value)}>
                <option value="">Choisir un client…</option>
                {candidates.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
              </select>
              {candidates.length === 0 && <div className="cell-sub" style={{ marginTop: 4 }}>Tous les clients de l'agence ont déjà un objectif.</div>}
            </label>
          )}
          <label className="field">
            <span className="field-label">Montant à atteindre (FCFA)</span>
            <input className="input" inputMode="numeric" value={target} placeholder="Ex : 250000"
                   onChange={e => setTarget(e.target.value.replace(/[^\d\s]/g, ""))}/>
          </label>
          <label className="field">
            <span className="field-label">Motif</span>
            <input className="input" list="goal-categories" value={category} maxLength={40}
                   placeholder="Scolarité, Logement…" onChange={e => setCategory(e.target.value)}/>
            <datalist id="goal-categories">
              {CATEGORIES.map(c => <option key={c} value={c}/>)}
            </datalist>
          </label>
          <label className="field">
            <span className="field-label">Échéance (facultatif)</span>
            <input className="input" type="date" value={deadline} min={toInputDate(Date.now())}
                   onChange={e => setDeadline(e.target.value)}/>
            <div className="cell-sub" style={{ marginTop: 4 }}>
              Sans échéance, le statut reste « En cours » : il n'y a pas de rythme à comparer.
            </div>
          </label>
          {error && <div role="alert" style={{ color: "var(--neg)", fontSize: 12.5 }}>{error}</div>}
        </div>
        <div className="drawer-foot">
          <button className="btn brand" disabled={busy} onClick={save}>
            <I.Check size={14} stroke="white"/>{isNew ? "Créer l'objectif" : "Enregistrer"}
          </button>
          <button className="btn" onClick={onClose}>Annuler</button>
          {!isNew && (
            <button className="btn ghost sm" style={{ marginLeft: "auto", color: "var(--neg)" }} disabled={busy}
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `Supprimer l'objectif de ${goal.client} ?`,
                        message: "L'épargne déjà versée reste sur le compte du client.",
                        confirmLabel: "Supprimer",
                        danger: true,
                      })
                      if (ok) run(() => removeGoal({ customerId: goal.id }))
                    }}>
              Supprimer
            </button>
          )}
        </div>
      </aside>
    </>
  )
}

/** Highlighted goal with remaining amount and months to completion. */
function SpotlightCard({ o, onOpen }) {
  if (!o) return null
  const reste = Math.max(0, o.target - o.current)
  const monthsNeeded = o.monthly > 0 ? Math.ceil(reste / o.monthly) : "—"
  return (
    <div className="card spotlight">
      <div className="card-head">
        <div>
          <div className="card-title">Le plus proche du palier</div>
          <div className="card-sub">Objectif client à mettre en avant cette semaine</div>
        </div>
        <button className="card-action" style={{ border: 0, background: "none", cursor: "pointer" }} onClick={onOpen}>
          Voir l'objectif <I.Arrow size={12}/>
        </button>
      </div>
      <div className="spotlight-body">
        <div className="spotlight-head">
          <div className="avatar lg">{initials(o.client)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: "-0.015em" }}>{o.client}</div>
            <div className="cell-sub">{[o.category ?? NO_CATEGORY, o.product, o.agent].filter(Boolean).join(" · ")}</div>
          </div>
          <span className="status-chip" data-status={o.status}>
            <span className="status-chip-dot" style={{ background: statusOf(o).dot }}/>
            {statusOf(o).label}
          </span>
        </div>

        <div className="spotlight-prog">
          <div className="spotlight-amount">
            <span className="big">{fmt(o.current)}</span>
            <span className="cell-sub" style={{ fontSize: 12.5, marginLeft: 6 }}>/ {fmt(o.target)} FCFA</span>
          </div>
          <div className="goal-bar" style={{ height: 8, marginTop: 12 }}>
            <div className="goal-fill" style={{ width: Math.min(100, o.pct) + "%" }}/>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>
            <span><strong style={{ color: "var(--ink)" }}>{o.pct}%</strong> atteint</span>
            <span>Reste {fmt(reste)} FCFA</span>
          </div>
        </div>

        <div className="spotlight-stats">
          <div>
            <div className="cell-sub">Cadence actuelle</div>
            <div className="ssv">{fmt(o.monthly)} <span className="u">/mois</span></div>
          </div>
          <div>
            <div className="cell-sub">Mois restants</div>
            <div className="ssv">{monthsNeeded} <span className="u">mois</span></div>
          </div>
          <div>
            <div className="cell-sub">Échéance</div>
            <div className="ssv" style={{ fontSize: 14 }}>{o.deadline ? fmtDate(o.deadline) : "—"}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Goal count per category. */
function CategoriesCard({ cats }) {
  const total = cats.reduce((s, c) => s + c.count, 0)
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Répartition par motif</div>
          <div className="card-sub">{total} objectif{total > 1 ? "s" : ""} dans l'agence</div>
        </div>
      </div>
      {total === 0 && <div className="cell-sub" style={{ padding: "8px 16px 16px" }}>Aucun objectif pour l'instant.</div>}
      <div style={{ padding: "4px 16px 8px" }}>
        <div className="cat-bar">
          {cats.map(c => (
            <span key={c.name} title={`${c.name} · ${c.count}`} style={{ flex: c.count, background: c.color }}/>
          ))}
        </div>
      </div>
      <div className="cat-list">
        {cats.map(c => (
          <div key={c.name} className="cat-row">
            <span className="cat-dot" style={{ background: c.color }}/>
            <span className="cat-name">{c.name}</span>
            <span className="cat-count">{c.count}</span>
            <span className="cat-sum">{fmt(c.sum)} <span className="cell-sub">FCFA</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Savings goals of the branch's clients: progress, pace and status, editable by portfolio managers. */
export default function ObjectifsPage() {
  const data = useQuery(api.portfolio.listGoals)
  const me = useQuery(api.users.me)
  const canEdit = !!me?.can?.managePortfolio
  const [q, setQ] = useState("")
  const [seg, setSeg] = useState("tous")
  const [cat, setCat] = useState("toutes")
  const [agent, setAgent] = useState("tous")
  const [sortBy, setSortBy] = useState("pct")
  const [sortDir, setSortDir] = useState("desc")
  const [editor, setEditor] = useState(null) // { goal } — goal null for a new one

  const goals = useMemo(() => data?.goals ?? [], [data])
  const agents = useMemo(() => ["tous", ...new Set(goals.map(o => o.agent))], [goals])
  const cats   = useMemo(() => ["toutes", ...new Set(goals.map(o => o.category ?? NO_CATEGORY))], [goals])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const r = goals.filter(o => {
      if (seg === "encours"  && (o.status === "atteint" || o.status === "enpause")) return false
      if (seg === "atteints" && o.status !== "atteint")  return false
      if (seg === "enretard" && o.status !== "enretard") return false
      if (seg === "enpause"  && o.status !== "enpause")  return false
      if (cat !== "toutes"   && (o.category ?? NO_CATEGORY) !== cat) return false
      if (agent !== "tous"   && o.agent !== agent)       return false
      if (needle && !o.client.toLowerCase().includes(needle) && !(o.category ?? "").toLowerCase().includes(needle)) return false
      return true
    })
    // No deadline sorts last either way
    const key = (o) => sortBy === "daysLeft" ? (o.daysLeft ?? (sortDir === "asc" ? Infinity : -Infinity)) : o[sortBy] ?? ""
    r.sort((a, b) => {
      const va = key(a), vb = key(b)
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "fr")
      return sortDir === "asc" ? cmp : -cmp
    })
    return r
  }, [goals, q, seg, cat, agent, sortBy, sortDir])
  const paged = usePaged(filtered)

  const counts = {
    tous:     goals.length,
    encours:  goals.filter(o => o.status !== "atteint" && o.status !== "enpause").length,
    atteints: goals.filter(o => o.status === "atteint").length,
    enretard: goals.filter(o => o.status === "enretard").length,
    enpause:  goals.filter(o => o.status === "enpause").length,
  }

  const categories = useMemo(() => {
    const m = new Map()
    for (const o of goals) {
      const name = o.category ?? NO_CATEGORY
      const c = m.get(name) ?? { name, count: 0, sum: 0, color: catColor(name) }
      c.count += 1
      c.sum += Math.max(0, o.current)
      m.set(name, c)
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [goals])

  const kpis = useMemo(() => {
    const open = goals.filter(o => o.status !== "atteint")
    const now = Date.now()
    const avg = open.length ? Math.round(open.reduce((s, o) => s + Math.min(100, o.pct), 0) / open.length) : 0
    return [
      { label: "Objectifs en cours",   value: String(open.length), unit: "", note: `${goals.length} clients avec un objectif`, icon: "users" },
      { label: "Épargne vers objectifs", value: fmt(open.reduce((s, o) => s + Math.max(0, o.current), 0)), unit: "FCFA",
        note: `sur ${fmt(open.reduce((s, o) => s + o.target, 0))} FCFA visés`, icon: "wallet" },
      { label: "Atteints (12 mois)",   value: String(goals.filter(o => o.reachedAt && o.reachedAt >= now - YEAR).length), unit: "", note: "objectifs franchis", icon: "coin" },
      { label: "Progression moyenne",  value: String(avg), unit: "%", note: "objectifs en cours", icon: "receipt" },
    ]
  }, [goals])

  const spotlight = useMemo(() =>
    goals
      .filter(o => o.status !== "atteint" && o.status !== "enpause")
      .sort((a, b) => b.pct - a.pct)[0]
  , [goals])

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortBy(col); setSortDir("desc") }
  }
  const sort = { sortBy, sortDir, onSort: toggleSort }

  const exportCsv = () => downloadCsv(
    `objectifs-${toInputDate(Date.now())}.csv`,
    ["Client", "Téléphone", "Agent", "Motif", "Objectif (FCFA)", "Épargne (FCFA)", "Progression (%)", "Cadence 30 j (FCFA)", "Échéance", "Statut"],
    filtered.map(o => [o.client, o.phone, o.agent, o.category ?? "", o.target, o.current, o.pct, o.monthly,
      o.deadline ? toInputDate(o.deadline) : "", statusOf(o).label]),
  )

  if (data === undefined) {
    return (
      <div className="objectifs-page">
        <PageHeader crumbs={["Objectifs"]} title="Objectifs d'épargne"><Novu /></PageHeader>
        <PageSkeleton />
      </div>
    )
  }

  return (
    <div className="objectifs-page">
      <PageHeader
        crumbs={["Objectifs"]}
        title="Objectifs d'épargne"
      >
        <Novu />
      </PageHeader>

      <section className="kpi-row">
        {kpis.map(k => <KPI key={k.label} k={k}/>)}
      </section>

      <section className="row obj-row" style={{ marginBottom: 14 }}>
        {spotlight
          ? <SpotlightCard o={spotlight} onOpen={() => canEdit && setEditor({ goal: spotlight })} />
          : <div className="card" style={{ padding: 24, color: "var(--ink-3)", fontSize: 13 }}>Aucun objectif en cours à mettre en avant.</div>}
        <CategoriesCard cats={categories} />
      </section>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <SearchInput placeholder="Client ou motif…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn" onClick={exportCsv} disabled={filtered.length === 0}><I.Export size={14}/>Exporter</button>
        {canEdit && (
          <button className="btn brand" onClick={() => setEditor({ goal: null })}>
            <I.Plus size={14} stroke="white"/>Nouvel objectif
          </button>
        )}
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="filter-bar">
          <div className="seg-tabs">
            {[
              { k: "tous",     label: "Tous",       n: counts.tous },
              { k: "encours",  label: "En cours",   n: counts.encours },
              { k: "atteints", label: "Atteints",   n: counts.atteints },
              { k: "enretard", label: "En retard",  n: counts.enretard },
              { k: "enpause",  label: "En pause",   n: counts.enpause },
            ].map(t => (
              <button key={t.k} aria-pressed={seg === t.k} className={"seg-tab " + (seg === t.k ? "on" : "")} onClick={() => setSeg(t.k)}>
                {t.label}<span className="seg-count">{t.n}</span>
              </button>
            ))}
          </div>
          <div className="filter-spacer"/>
          <label className="filter-group">
            <span className="filter-label">Motif</span>
            <select className="filter-select" value={cat} onChange={e => setCat(e.target.value)}>
              {cats.map(a => <option key={a} value={a}>{a === "toutes" ? "Tous" : a}</option>)}
            </select>
          </label>
          <label className="filter-group">
            <span className="filter-label">Agent</span>
            <select className="filter-select" value={agent} onChange={e => setAgent(e.target.value)}>
              {agents.map(a => <option key={a} value={a}>{a === "tous" ? "Tous les agents" : a}</option>)}
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table className="data-table obj-table">
            <thead>
              <tr>
                <SortHead {...sort} col="client">Client</SortHead>
                <SortHead {...sort} col="category">Motif</SortHead>
                <th style={{ width: "26%" }}>Progression</th>
                <SortHead {...sort} col="current" align="right">Épargne</SortHead>
                <SortHead {...sort} col="monthly" align="right">Cadence 30 j</SortHead>
                <SortHead {...sort} col="daysLeft">Échéance</SortHead>
                <SortHead {...sort} col="status">Statut</SortHead>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map(o => {
                const st = statusOf(o)
                return (
                  <tr key={o.id} style={{ cursor: canEdit ? "pointer" : undefined }}
                      {...(canEdit ? keyActivate(() => setEditor({ goal: o })) : {})}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="avatar sm">{initials(o.client)}</div>
                        <div>
                          <div style={{ fontWeight: 550 }}>{o.client}</div>
                          <div className="cell-sub">{o.agent}{o.product ? ` · ${o.product}` : ""}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {o.category ? (
                        <span className="chip cat-chip">
                          <span className="cat-dot" style={{ background: catColor(o.category) }}/>
                          {o.category}
                        </span>
                      ) : <span className="cell-sub">—</span>}
                    </td>
                    <td>
                      <div className="prog-cell">
                        <div className="prog-row">
                          <span className="prog-pct">{o.pct}%</span>
                          <span className="prog-target">{fmt(o.target)} <span className="cell-sub">FCFA</span></span>
                        </div>
                        <div className="goal-bar">
                          <div className="goal-fill" style={{
                            width: Math.min(100, o.pct) + "%",
                            background:
                              o.status === "atteint"  ? "linear-gradient(90deg, var(--pos), oklch(0.65 0.12 155))" :
                              o.status === "enretard" ? "linear-gradient(90deg, var(--neg), oklch(0.7 0.16 30))" :
                              o.status === "enpause"  ? "linear-gradient(90deg, oklch(0.78 0.01 70), oklch(0.85 0.01 70))" :
                              undefined
                          }}/>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 550 }}>
                      {fmt(o.current)}<span className="cell-sub" style={{ marginLeft: 4 }}>FCFA</span>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink-2)" }}>
                      {o.monthly > 0 ? fmt(o.monthly) : "—"}
                      {o.monthly > 0 && <span className="cell-sub" style={{ marginLeft: 4 }}>FCFA</span>}
                    </td>
                    <td>
                      {o.status === "atteint" ? (
                        <span className="cell-sub">{o.reachedAt ? `Atteint le ${fmtDate(o.reachedAt)}` : "Atteint"}</span>
                      ) : o.deadline === null ? (
                        <span className="cell-sub">—</span>
                      ) : (
                        <div style={{ lineHeight: 1.25 }}>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>
                            {o.daysLeft > 0 ? `${o.daysLeft} j` : o.daysLeft === 0 ? "Aujourd'hui" : "Dépassée"}
                          </div>
                          <div className="cell-sub">{fmtDate(o.deadline)}</div>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="status-chip" data-status={o.status}>
                        <span className="status-chip-dot" style={{ background: st.dot }}/>
                        {st.label}
                      </span>
                    </td>
                    <td>{canEdit && <span className="btn ghost sm" style={{ padding: 4 }}><I.Arrow size={12}/></span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
              {goals.length === 0
                ? "Aucun client n'a encore d'objectif. Les agents le fixent à l'inscription dans l'application, ou utilisez « Nouvel objectif »."
                : "Aucun objectif ne correspond aux filtres."}
            </div>
          )}
          <Pager paged={paged} unit="objectifs" />
        </div>
      </div>

      {editor && (
        <GoalEditor goal={editor.goal} candidates={data.withoutGoal} onClose={() => setEditor(null)} />
      )}
    </div>
  )
}
