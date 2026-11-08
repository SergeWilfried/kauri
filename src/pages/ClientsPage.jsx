import { useState, useMemo } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { I } from '../icons'
import { errorMessage, fmt, fmtDateTime, initials, SortHead, pressable, relTime, KPI, KpiSkeleton, TableSkeleton, PageHeader, SearchInput } from '../components'
import { Pager, usePaged } from '../components/Pager'
import IdDocument from '../components/IdDocument'
import ClientProfile from '../components/ClientProfile'
import { ImportButton } from '../components/ImportDialog'
import Novu from '../components/Inbox'
import { useDialog } from '../components/useDialog'

/**
 * The client's product: a picker of the active products offered in the
 * client's branch for portfolio managers, the product name for everyone else.
 */
function ProductField({ client }) {
  const me = useQuery(api.users.me)
  const catalogue = useQuery(api.portfolio.listProducts)
  const setProduct = useMutation(api.portfolio.setCustomerProduct)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  if (catalogue === undefined) return <span className="cell-sub">…</span>
  const current = catalogue.products.find(p => p.id === client.productId)
  if (!me?.can?.managePortfolio) return <>{current?.name ?? "—"}</>

  const branchId = me.branchId
  const options = catalogue.products.filter(p => p.status === "actif" && p.branchIds.includes(branchId))
  const change = async (value) => {
    setBusy(true)
    setError("")
    try { await setProduct({ customerId: client.id, productId: value || null }) }
    catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }
  return (
    <>
      <select className="filter-select" aria-label="Produit" value={client.productId ?? ""} disabled={busy}
              onChange={e => change(e.target.value)}>
        <option value="">Aucun produit</option>
        {/* Keep showing a product that was archived since it was assigned */}
        {current && !options.includes(current) && <option value={current.id}>{current.name} (inactif)</option>}
        {options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {error && <div role="alert" style={{ color: "var(--neg)", fontSize: 12, marginTop: 4 }}>{error}</div>}
    </>
  )
}

const CLIENT_STATUS = {
  actif:   { cls: "actif",   label: "Actif" },
  archive: { cls: "archive", label: "Archivé" },
}
/** The client's status as a tag; anything else is still awaiting KYC. */
const ClientStatus = ({ status }) => {
  const s = CLIENT_STATUS[status] ?? { cls: "attente", label: "En attente" }
  return <span className={"tag " + s.cls}>{s.label}</span>
}

/**
 * Client detail drawer: who the client is (header), three key figures in one
 * row, the profile as a compact two-column grid, then the recent movements.
 * Deposits and withdrawals are recorded on the TPE, so the only action here is
 * calling the client.
 */
function ClientDrawer({ client, onClose }) {
  const history = useQuery(api.admin.customerHistory, client ? { customerId: client.id } : "skip")
  const ref = useDialog(onClose, !!client)
  if (!client) return null
  const since = new Date(client.joined).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
  return (
    <>
      <div className="drawer-scrim" onClick={onClose}/>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Client ${client.name}`} ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div className="avatar lg">{initials(client.name)}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: "-0.015em" }}>{client.name}</span>
                <ClientStatus status={client.status} />
              </div>
              <div className="cell-sub" style={{ marginTop: 2 }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{client.phone}</span> · client depuis {since}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {client.phone && (
              <a className="btn sm" href={`tel:${client.phone}`} title={`Appeler ${client.phone}`}>
                <I.Phone size={14}/>Appeler
              </a>
            )}
            <button className="btn ghost sm" onClick={onClose} style={{ padding: 6 }} aria-label="Fermer">✕</button>
          </div>
        </div>

        <div className="drawer-body" style={{ gap: 18 }}>
          <div className="stat-grid cols-3">
            <div className="stat"><div className="cell-sub">Solde</div><div className="stat-v">{fmt(client.balance)}<span className="u">FCFA</span></div></div>
            <div className="stat"><div className="cell-sub">Dépôts ce mois</div><div className="stat-v">{fmt(client.monthlyAvg)}<span className="u">FCFA</span></div></div>
            <div className="stat"><div className="cell-sub">Mouvements</div><div className="stat-v">{client.txCount}</div></div>
          </div>

          <dl className="field-grid">
            <div><dt>Agence</dt><dd>{client.branch}</dd></div>
            <div><dt>Agent référent</dt><dd>{client.agent}</dd></div>
            <div><dt>Pièce d'identité</dt><dd style={{ fontFamily: client.idNumber ? "var(--font-mono)" : undefined }}>{client.idNumber || <span className="cell-sub">Non renseignée</span>}</dd></div>
            <div><dt>Dernier mouvement</dt><dd>{client.lastTx ? relTime(client.lastTx) : <span className="cell-sub">Aucun</span>}</dd></div>
            <div className="span-2"><dt>Produit</dt><dd><ProductField client={client} /></dd></div>
            <div className="span-2"><dt>Pièce d'identité · photos</dt><dd><IdDocument customerId={client.id} /></dd></div>
          </dl>

          <ClientProfile key={client.id} client={client} />

          <div className="drawer-section">
            <div style={{ display: "flex", alignItems: "baseline", marginBottom: 6 }}>
              <div className="card-title">Historique récent</div>
              {history && history.length > 0 && (
                <span className="cell-sub" style={{ marginLeft: "auto" }}>{history.length} dernier{history.length > 1 ? "s" : ""} mouvement{history.length > 1 ? "s" : ""}</span>
              )}
            </div>
            <div className="tx-list" style={{ padding: 0 }}>
              {history === undefined && <TableSkeleton rows={3} label="Chargement de l'historique…" />}
              {history && history.length === 0 && <div className="cell-sub" style={{ padding: 12 }}>Aucun mouvement</div>}
              {(history ?? []).map((t) => (
                <div key={t.id} className="tx-row">
                  <div className={"tx-icon " + t.type}>{t.type === "in" ? <I.ArrowDown size={14}/> : <I.ArrowUp size={14}/>}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="tx-name">{t.label}{t.status === "annulée" ? " (annulé)" : ""}</div>
                    <div className="tx-time">{fmtDateTime(t.timestamp)} · {t.agent}</div>
                  </div>
                  <div className={"tx-amount " + t.type}>{t.type === "in" ? "+" : "−"}{fmt(t.amount)}<span className="u">FCFA</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

/** Client list with status and agent filters, sorting, search, table/card views and the detail drawer. */
export default function ClientsPage() {
  const [q, setQ] = useState("")
  const [seg, setSeg] = useState("tous")
  const [sortBy, setSortBy] = useState("balance")
  const [sortDir, setSortDir] = useState("desc")
  const [agent, setAgent] = useState("tous")
  const [view, setView] = useState("table")
  const [selected, setSelected] = useState(new Set())
  const [openClient, setOpenClient] = useState(null)

  const rows = useQuery(api.admin.listCustomers)
  const CLIENTS = rows ?? []

  const agents = useMemo(() => ["tous", ...Array.from(new Set(CLIENTS.map(c => c.agent)))], [rows])

  const filtered = useMemo(() => {
    let r = CLIENTS.filter(c => {
      if (seg !== "tous" && c.status !== seg) return false
      if (agent !== "tous" && c.agent !== agent) return false
      if (q && !c.name.toLowerCase().includes(q.toLowerCase()) && !c.phone.includes(q) && !c.village.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
    r.sort((a, b) => {
      const va = a[sortBy], vb = b[sortBy]
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "fr")
      return sortDir === "asc" ? cmp : -cmp
    })
    return r
  }, [rows, q, seg, agent, sortBy, sortDir])

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortBy(col); setSortDir("desc") }
  }
  const sort = { sortBy, sortDir, onSort: toggleSort }

  const counts = {
    tous:    CLIENTS.length,
    actif:   CLIENTS.filter(c => c.status === "actif").length,
    attente: CLIENTS.filter(c => c.status === "attente").length,
    archive: CLIENTS.filter(c => c.status === "archive").length,
  }

  const toggle = (id) => {
    const n = new Set(selected)
    n.has(id) ? n.delete(id) : n.add(id)
    setSelected(n)
  }
  const paged = usePaged(filtered)
  const allOn = filtered.length > 0 && filtered.every(c => selected.has(c.id))
  const toggleAll = () => {
    if (allOn) setSelected(new Set())
    else setSelected(new Set(filtered.map(c => c.id)))
  }

  const sumBalance = CLIENTS.reduce((s, c) => s + c.balance, 0)
  const CLIENT_KPIS = [
    { label: "Clients (total)", value: String(counts.tous),    unit: "",     delta: String(counts.tous),    dir: "up", note: "fiches",              icon: "users" },
    { label: "Actifs",          value: String(counts.actif),   unit: "",     delta: counts.tous ? Math.round(counts.actif / counts.tous * 100) + "%" : "—", dir: "up", note: "du portefeuille", icon: "users" },
    { label: "Solde moyen",     value: fmt(counts.tous ? Math.round(sumBalance / counts.tous) : 0), unit: "FCFA", delta: fmt(sumBalance), dir: "up", note: "FCFA cumulés", icon: "wallet" },
    { label: "En attente KYC",  value: String(counts.attente), unit: "",     delta: String(counts.archive), dir: counts.archive ? "down" : "up", note: "rejetés", icon: "shield" },
  ]

  return (
    <div className="clients-page">
      <PageHeader
        crumbs={["Clients"]}
        title="Clients"
      >
        <ImportButton kind="customers" />
        <Novu />
      </PageHeader>

      {rows === undefined ? <KpiSkeleton /> : (
        <section className="kpi-row">
          {CLIENT_KPIS.map(k => <KPI key={k.label} k={k}/>)}
        </section>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <SearchInput placeholder="Nom, téléphone, village…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn"><I.Export size={14}/>Exporter</button>
        <button className="btn brand"><I.Plus size={14} stroke="white"/>Nouveau client</button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="filter-bar">
          <div className="seg-tabs">
            {[
              { k: "tous",    label: "Tous",        n: counts.tous },
              { k: "actif",   label: "Actifs",      n: counts.actif },
              { k: "attente", label: "En attente",  n: counts.attente },
              { k: "archive", label: "Archivés",    n: counts.archive },
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
              {agents.map(a => <option key={a} value={a}>{a === "tous" ? "Tous les agents" : a}</option>)}
            </select>
          </label>
          <div className="seg">
            <button aria-pressed={view === "table"} className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Tableau</button>
            <button aria-pressed={view === "cards"} className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>Cartes</button>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="bulk-bar">
            <strong>{selected.size}</strong> sélectionné{selected.size > 1 ? "s" : ""}
            <div style={{ flex: 1 }}/>
            <button className="btn sm"><I.Export size={12}/>Exporter</button>
            <button className="btn sm">Assigner agent</button>
            <button className="btn sm">Archiver</button>
            <button className="btn ghost sm" onClick={() => setSelected(new Set())}>Effacer</button>
          </div>
        )}

        {view === "table" ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Sélectionner tous les clients affichés" /></th>
                  <SortHead {...sort} col="name">Client</SortHead>
                  <SortHead {...sort} col="village">Village</SortHead>
                  <SortHead {...sort} col="branch">Agence</SortHead>
                  <SortHead {...sort} col="balance" align="right">Solde</SortHead>
                  <SortHead {...sort} col="monthlyAvg" align="right">Ce mois</SortHead>
                  <SortHead {...sort} col="txCount" align="right">Mvts</SortHead>
                  <SortHead {...sort} col="agent">Agent</SortHead>
                  <SortHead {...sort} col="status">Statut</SortHead>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map(c => (
                  <tr key={c.id} onClick={() => setOpenClient(c)} className={selected.has(c.id) ? "selected" : ""}>
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Sélectionner ${c.name}`} />
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div className="avatar sm">{initials(c.name)}</div>
                        <div>
                          <div style={{ fontWeight: 550 }}>{c.name}</div>
                          <div className="cell-sub">{c.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td>{c.village}</td>
                    <td><span className="chip">{c.branch}</span></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 550 }}>
                      {fmt(c.balance)}<span className="cell-sub" style={{ marginLeft: 4 }}>FCFA</span>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink-2)" }}>
                      {fmt(c.monthlyAvg)}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink-2)" }}>{c.txCount}</td>
                    <td className="cell-sub">{c.agent}</td>
                    <td>
                      <ClientStatus status={c.status} />
                    </td>
                    <td><button className="btn ghost sm" style={{ padding: 4 }} aria-label={`Ouvrir la fiche de ${c.name}`} onClick={e => { e.stopPropagation(); setOpenClient(c) }}><I.Arrow size={12}/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows === undefined && <TableSkeleton rows={6} label="Chargement des clients…" />}
            {rows !== undefined && filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
                Aucun client ne correspond aux filtres.
              </div>
            )}
            <Pager paged={paged} unit="clients" />
          </div>
        ) : (
          <div className="card-grid">
            {paged.rows.map(c => (
              <div key={c.id} className="client-card" {...pressable(() => setOpenClient(c), `Ouvrir la fiche de ${c.name}`)}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="avatar lg">{initials(c.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div className="cell-sub">{c.phone}</div>
                  </div>
                  <ClientStatus status={c.status} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 12 }}>
                  <div>
                    <div className="cell-sub">Solde</div>
                    <div style={{ fontWeight: 600, fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{fmt(c.balance)} <span style={{ fontSize: 11, color: "var(--ink-3)" }}>FCFA</span></div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="cell-sub">Dernier mvt</div>
                    <div style={{ fontWeight: 550 }}>{relTime(c.lastTx)}</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 11.5, color: "var(--ink-3)" }}>
                  <span>{c.village} · {c.agent}</span>
                  <span>{c.txCount} mvts</span>
                </div>
              </div>
            ))}
            <div style={{ gridColumn: "1 / -1" }}><Pager paged={paged} unit="clients" /></div>
          </div>
        )}
      </div>

      {/* Latest row, so edits made in the drawer show up in it */}
      <ClientDrawer client={openClient && ((rows ?? []).find(r => r.id === openClient.id) ?? openClient)} onClose={() => setOpenClient(null)} />
    </div>
  )
}
