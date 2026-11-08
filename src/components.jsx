import { useState, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import { api } from '../convex/_generated/api'
import { I } from './icons'
import { MizoMark, MizoWordmark } from './components/Brand'
import { canOpenPage } from './access'

/** Format a number with French thousands separators. */
export function fmt(n) {
  return n.toLocaleString("fr-FR").replace(/,/g, " ")
}

/** Up to two uppercase initials from a name. */
export function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("")
}

/** Relative French time ("il y a 5 min", "hier") for a timestamp. */
export function relTime(ts) {
  if (!ts) return "—"
  const diff = Date.now() - ts
  const min = Math.round(diff / 60000)
  if (min < 1)  return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 24)   return `il y a ${h} h`
  const d = Math.round(h / 24)
  if (d === 1)  return "hier"
  return `il y a ${d} j`
}

/** French date and time, using "Aujourd'hui" / "Hier" for recent days. */
/** A length of time in words: "12 min", "3 h", "2 j". */
export function fmtDuration(ms) {
  const min = Math.round(Math.abs(ms) / 60000)
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} j`
}

/** OpenStreetMap link centred on a GPS fix ({ lat, lng }). */
export const mapUrl = (p) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`

export function fmtDateTime(ts) {
  if (!ts) return "—"
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  if (d.toDateString() === today.toDateString())     return `Aujourd'hui, ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `Hier, ${time}`
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}, ${time}`
}

// Server errors → French. ConvexError codes pass through in production; plain
// Error messages are matched by substring (production redacts those, hence
// the generic fallback).
const ERROR_MESSAGES = {
  SELF_CHANGE:       "Vous ne pouvez pas modifier votre propre compte.",
  NOT_FOUND:         "Membre du personnel introuvable.",
  NAME_REQUIRED:     "Le nom est obligatoire.",
  INVALID_EMAIL:     "Adresse email invalide.",
  PHONE_REQUIRED:    "Le téléphone est obligatoire.",
  BRANCH_NOT_FOUND:  "Agence introuvable.",
  EMAIL_TAKEN:       "Un membre du personnel utilise déjà cet email.",
  ALREADY_ACTIVATED: "Ce compte est déjà activé.",
  NOT_ACTIVATED:     "Ce compte n'a pas encore de mot de passe : générez un code d'activation.",
  SUSPENDED:         "Ce compte est suspendu.",
  FORBIDDEN:         "Vous n'avez pas l'autorisation pour cette action.",
  INVALID_PHONE:     "Numéro de téléphone invalide.",
  PHONE_TAKEN:       "Ce numéro de téléphone est déjà utilisé.",
  INVALID_ID_NUMBER: "Numéro de pièce d'identité trop long.",
  INVALID_AMOUNT:    "Montant invalide.",
  INVALID_IMAGE:     "Choisissez une image (JPEG, PNG…) de 5 Mo maximum.",
  INVALID_PROFILE:   "Vérifiez l'année de naissance et le nombre d'enfants.",
  CUSTOMER_NOT_FOUND: "Client introuvable dans cette agence.",
  NO_DEVICE:         "Aucun TPE actif n'est lié à cet agent.",
  DAY_CLOSED:        "La caisse du jour est déjà clôturée.",
  INSUFFICIENT_BALANCE: "Solde du client insuffisant.",
  INVALID_CODE:      "Code produit invalide : 2 à 20 lettres, chiffres ou + . _ -",
  CODE_TAKEN:        "Un autre produit utilise déjà ce code.",
  SUMMARY_TOO_LONG:  "La description dépasse 300 caractères.",
  INVALID_TERMS:     "Conditions invalides : vérifiez taux, durées, montants et niveau KYC.",
  INVALID_BRANCH:    "Agence inconnue.",
  PRODUCT_INACTIVE:  "Ce produit n'est pas actif.",
  PRODUCT_NOT_IN_BRANCH: "Ce produit n'est pas proposé dans l'agence du client.",
  INVALID_TARGET:    "Le montant de l'objectif doit être un nombre entier positif.",
  INVALID_CATEGORY:  "Motif trop long (40 caractères max).",
  INVALID_DEADLINE:  "L'échéance ne peut pas être dans le passé.",
}
const ERROR_PATTERNS = [
  [/Unauthenticated|session/i,                  "Session expirée. Reconnectez-vous."],
  [/suspended/i,                                 "Compte suspendu."],
  [/permission|not authorized|forbidden|denied/i, "Vous n'avez pas l'autorisation pour cette action."],
  [/TPE not bound/i,                             "Ce TPE n'est pas lié à cet agent."],
  [/Only field agents and supervisors/i,         "Seuls les agents terrain et superviseurs peuvent recevoir un TPE."],
  [/already bound/i,                             "Ce TPE est déjà lié à un autre agent : déliez-le d'abord."],
  [/Agent already has/i,                         "Cet agent a déjà un TPE : déliez-le d'abord."],
  [/only active devices/i,                       "Seuls les TPE actifs peuvent être liés."],
  [/Already reversed/i,                          "Transaction déjà annulée."],
  [/daily cash already settled|already reconciled/i, "La caisse du jour est déjà clôturée."],
  [/No transactions found/i,                     "Aucune collecte aujourd'hui pour cet agent."],
  [/cannot approve your own/i,                   "Vous ne pouvez pas approuver votre propre demande."],
]
/** Download rows as a semicolon-separated CSV that Excel opens with accents intact. */
export function downloadCsv(filename, header, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return ""
    // Numbers stay numbers (negative balances included)
    if (typeof v === "number") return String(v)
    // Text that Excel would run as a formula (names, reasons typed by staff)
    let t = String(v)
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t
    return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const text = [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n")
  const url = URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * French message for a server error: known ConvexError codes and server messages are mapped, anything else gets a generic message.
 */
/**
 * Sortable column header. Declared here, not inside a page, so re-sorting
 * keeps the same button mounted and keyboard focus stays on it.
 */
export function SortHead({ col, sortBy, sortDir, onSort, align, children }) {
  const on = sortBy === col
  return (
    <th style={{ textAlign: align || "left" }}
        aria-sort={on ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" className="sort-btn" onClick={() => onSort(col)}>
        {children}
        <span aria-hidden="true" style={{ opacity: on ? 1 : 0.25, fontSize: 9 }}>
          {on ? (sortDir === "asc" ? "▲" : "▼") : "▾"}
        </span>
      </button>
    </th>
  )
}

/** Enter/Space run `fn` on a focusable element that isn't a button (table row). */
export function keyActivate(fn) {
  return {
    tabIndex: 0,
    onClick: fn,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return
      e.preventDefault()
      fn()
    },
  }
}

/** A card that opens something: a named button for keyboard and screen readers. */
export function pressable(fn, label) {
  return { role: "button", "aria-label": label, ...keyActivate(fn) }
}

export function errorMessage(e) {
  if (typeof e?.data === "string" && ERROR_MESSAGES[e.data]) return ERROR_MESSAGES[e.data]
  const text = String(e?.data ?? e?.message ?? "")
  for (const [re, msg] of ERROR_PATTERNS) if (re.test(text)) return msg
  return "Une erreur est survenue. Réessayez ou contactez l'Admin IT."
}

/** Inline loading placeholder. */
export function Loading({ label = "Chargement…" }) {
  return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>{label}</div>
}

/** Grey placeholder bar shown while data loads. */
export function Skel({ w = "100%", h = 12, r = 6, style }) {
  return <span className="skel" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />
}

/**
 * The one screen-reader announcement for a loading state. The placeholders
 * themselves are decorative (aria-hidden), so a page showing several of
 * them still announces once.
 */
export function LoadingStatus({ label = "Chargement…" }) {
  return <span role="status" className="sr-only">{label}</span>
}

/** Placeholder KPI tiles, same grid as the real ones (decorative). */
export function KpiSkeleton({ count = 4 }) {
  return (
    <section className="kpi-row" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="kpi" key={i}>
          <Skel w="45%" h={11} />
          <Skel w="60%" h={26} style={{ margin: "14px 0 12px" }} />
          <Skel w="70%" h={10} />
        </div>
      ))}
    </section>
  )
}

/**
 * Placeholder table rows: an avatar-ish dot, a two-line label and a few
 * cells. Pass `label` to announce the loading state from here.
 */
export function TableSkeleton({ rows = 6, cols = 4, label }) {
  return (
    <>
    {label && <LoadingStatus label={label} />}
    <div className="skel-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-row" key={i}>
          <Skel w={28} h={28} r={14} />
          <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 6 }}>
            <Skel w={`${55 + ((i * 17) % 30)}%`} h={11} />
            <Skel w="35%" h={9} />
          </div>
          {Array.from({ length: cols - 1 }, (_, j) => <Skel key={j} w="auto" h={11} style={{ flex: 1 }} />)}
        </div>
      ))}
    </div>
    </>
  )
}

/** KPI tiles and a table card, for pages whose data hasn't arrived yet. */
export function PageSkeleton({ kpis = 4, rows = 8 }) {
  return (
    <>
      <LoadingStatus />
      <KpiSkeleton count={kpis} />
      <div className="card" style={{ marginBottom: 14 }} aria-hidden="true">
        <div className="skel-row" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <Skel w={220} h={28} r={8} />
          <span style={{ flex: 1 }} />
          <Skel w={140} h={28} r={8} />
        </div>
        <TableSkeleton rows={rows} />
      </div>
    </>
  )
}

/** Search field with icon, controlled by `value` / `onChange`. */
export function SearchInput({ placeholder, value, onChange, width = 240 }) {
  return (
    <div className="search" style={{ width }}>
      <I.Search />
      <input placeholder={placeholder} value={value} onChange={onChange} />
    </div>
  )
}

/**
 * Page top bar with breadcrumbs, title, optional `sub` line and actions (`children`).
 * crumbs: string[] — segments after "Mizo", e.g. ["Admin", "Agents & TPE"]
 */
export function PageHeader({ crumbs = [], title, children }) {
  const allCrumbs = title ? [...crumbs, title] : crumbs
  return (
    <>
    <header className="topbar">
      <div className="crumbs">
        <strong>Mizo</strong>
        {allCrumbs.map((c, i) => (
          <span key={c}>
            <span className="crumb-sep">/</span>
            {i === allCrumbs.length - 1 ? <span className="crumb-current">{c}</span> : c}
          </span>
        ))}
      </div>
      <div className="topbar-right">
        {children}
      </div>
    </header>
    </>
  )
}

/** Small inline trend line for KPI cards. */
export function Sparkline({ data, color = "var(--brand)" }) {
  if (!data || !data.length) return null
  const w = 86, h = 32, max = Math.max(...data), min = Math.min(...data)
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - 4) + 2
    const y = h - 4 - ((v - min) / (max - min || 1)) * (h - 8)
    return [x, y]
  })
  const d = pts.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(" ")
  const area = d + ` L ${w - 2} ${h - 2} L 2 ${h - 2} Z`
  const id = "sg-" + Math.random().toString(36).slice(2, 7)
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const ROLE_LABELS = {
  field_agent: "Agent terrain",
  supervisor:  "Superviseur",
  accountant:  "Comptable",
  it_admin:    "Admin IT",
}

/** Main navigation, with the signed-in staff member and sign-out in the footer. */
export function Sidebar({ active, setActive }) {
  const me = useQuery(api.users.me)
  const { signOut } = useAuthActions()
  const allowed = (it) => canOpenPage(it.id, me?.can)
  const items = [
    { group: "Principal", entries: [
      { id: "dashboard", label: "Tableau de bord", icon: <I.Grid /> },
      { id: "clients",   label: "Clients",         icon: <I.Users /> },
      { id: "tx",             label: "Transactions",    icon: <I.Receipt /> },
      { id: "objectifs",      label: "Objectifs",       icon: <I.Pin /> },
      { id: "produits",       label: "Produits",        icon: <I.Wallet /> },
      { id: "reconciliation", label: "Réconciliation",  icon: <I.Coin /> },
    ]},
    { group: "Admin", entries: [
      { id: "agents",      label: "Agents",      icon: <I.Users /> },
      { id: "settings",    label: "Paramètres",  icon: <I.Settings /> },
    ]},
  ].map(g => ({ ...g, entries: g.entries.filter(allowed) })).filter(g => g.entries.length > 0)
  return (
    <aside className="sidebar">
      <div className="brand">
        <MizoMark />
        <div>
          <div className="brand-name"><MizoWordmark /></div>
          <div className="brand-sub">Gestion d'épargne</div>
        </div>
      </div>
      {items.map(group => (
        <div className="nav-group" key={group.group}>
          <div className="nav-label">{group.group}</div>
          {group.entries.map(it => (
            <button key={it.id} type="button"
                 className={"nav-item" + (active === it.id ? " active" : "")}
                 aria-current={active === it.id ? "page" : undefined}
                 onClick={() => setActive(it.id)}>
              {it.icon}<span>{it.label}</span>
              {it.badge && <span className="nav-badge">{it.badge}</span>}
            </button>
          ))}
        </div>
      ))}
      <div className="sidebar-foot">
        <div className="avatar">{me ? initials(me.name) : "…"}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="user-name">{me?.name ?? "…"}</div>
          <div className="user-role">
            {[me?.roles?.map(r => ROLE_LABELS[r] ?? r).join(", ") || "Aucun rôle", me?.branch].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button className="btn ghost sm" title="Se déconnecter" style={{ padding: "5px" }} onClick={() => signOut()}><I.Logout size={14}/></button>
      </div>
    </aside>
  )
}

/** Dashboard top bar with the ⌘K search trigger and an optional inbox. */
export function Topbar({ inbox }) {
  return (
    <div className="topbar">
      <div className="crumbs"><strong>Mizo</strong> &nbsp;/&nbsp; Tableau de bord</div>
      <div className="topbar-right">
        {inbox}
      </div>
    </div>
  )
}

/** One KPI card: label, value, delta and sparkline. */
export function KPI({ k }) {
  const Ic = { users: I.Users, wallet: I.Wallet, receipt: I.Receipt, coin: I.Coin }[k.icon]
  return (
    <div className="kpi">
      <div className="kpi-label">{Ic && <Ic />}{k.label}</div>
      <div className="kpi-value">{k.value}{k.unit && <span className="unit">{k.unit}</span>}</div>
      <div className="kpi-foot">
        {k.delta !== undefined && (
          <span className={"delta " + (k.dir === "up" ? "up" : "down")}>
            {k.dir === "up" ? <I.ArrowUR size={10} stroke="currentColor"/> : <I.ArrowDR size={10} stroke="currentColor"/>}
            {k.delta}
          </span>
        )}
        <span>{k.note}</span>
      </div>
      <Sparkline data={k.spark} color={k.dir === "up" ? "var(--brand)" : "var(--ink-3)"}/>
    </div>
  )
}

/** Dashboard card with the most recently active clients and an inline search. */
export function ClientsCard({ clients }) {
  const [q, setQ] = useState("")
  const filtered = useMemo(() =>
    clients.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q))
  , [q, clients])
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Derniers clients</div>
          <div className="card-sub">Triés par activité récente</div>
        </div>
        <span className="card-action">Voir tous <I.Arrow size={12}/></span>
      </div>
      <div style={{ padding: "0 18px 10px" }}>
        <div className="search">
          <I.Search /><input placeholder="Rechercher un client…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>
      <div className="clients-list">
        {filtered.map(c => (
          <div className="client-row" key={c.id}>
            <div className="avatar">{initials(c.name)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="client-name">{c.name}</div>
              <div className="client-meta">{c.phone} · dernier mvt {relTime(c.lastTx)}</div>
            </div>
            <div className="client-amount">
              <div className="v">{fmt(c.balance)}<span className="u">FCFA</span></div>
              <span className={"tag " + (c.status === "actif" ? "actif" : c.status === "archive" ? "archive" : "attente")}>
                {c.status === "actif" ? "Actif" : c.status === "archive" ? "Archivé" : "En attente"}
              </span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>Aucun client trouvé</div>
        )}
      </div>
    </div>
  )
}

/** Dashboard card listing the latest movements. */
export function TransactionsCard({ tx }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Transactions récentes</div>
          <div className="card-sub">Derniers mouvements · tous agents</div>
        </div>
        <span className="card-action">Historique <I.Arrow size={12}/></span>
      </div>
      <div className="tx-list">
        {tx.map(t => (
          <div className="tx-row" key={t.id}>
            <div className={"tx-icon " + t.type}>
              {t.type === "in" ? <I.ArrowDown size={14}/> : <I.ArrowUp size={14}/>}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="tx-name">{t.label} — {t.client}</div>
              <div className="tx-time">{fmtDateTime(t.timestamp)} · {t.agent}</div>
            </div>
            <div className={"tx-amount " + t.type}>
              {t.type === "in" ? "+" : "−"}{fmt(t.amount)}<span className="u">FCFA</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Monthly deposits vs withdrawals bar chart, in thousands of FCFA. */
export function VolumeChart({ data }) {
  const [range, setRange] = useState("6m")
  const w = 540, h = 200, pad = { l: 28, r: 12, t: 16, b: 26 }
  const max = Math.max(1, ...data.map(d => d.in + d.out)) * 1.15
  const bw = (w - pad.l - pad.r) / data.length * 0.55
  const gap = (w - pad.l - pad.r) / data.length

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Volume mensuel</div>
          <div className="card-sub">Dépôts vs. retraits · en milliers FCFA</div>
        </div>
        <div className="chart-legend" style={{ marginRight: 12 }}>
          <span className="legend-dot" style={{ "--c": "var(--brand)" }}>Dépôts</span>
          <span className="legend-dot" style={{ "--c": "oklch(0.82 0.01 70)" }}>Retraits</span>
        </div>
        <div className="seg">
          {["3m","6m","12m"].map(r => (
            <button key={r} aria-pressed={range === r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: "block" }}>
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
            const y = pad.t + (h - pad.t - pad.b) * (1 - t)
            return (
              <g key={i}>
                <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--border-subtle)" strokeDasharray={t === 0 ? "0" : "2 4"} />
                <text x={pad.l - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--ink-4)" fontFamily="var(--font-sans)">
                  {Math.round(max * t)}k
                </text>
              </g>
            )
          })}
          {data.map((d, i) => {
            const x = pad.l + i * gap + (gap - bw) / 2
            const totalH = h - pad.t - pad.b
            const inH = (d.in / max) * totalH
            const outH = (d.out / max) * totalH
            return (
              <g key={d.m}>
                <rect x={x} y={h - pad.b - outH} width={bw} height={outH} fill="oklch(0.85 0.008 70)" rx="3" />
                <rect x={x} y={h - pad.b - outH - inH} width={bw} height={inH} fill="var(--brand)" rx="3" />
                <text x={x + bw / 2} y={h - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)" fontFamily="var(--font-sans)">{d.m}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

/** Dashboard card with savings goal progress. */
export function GoalsCard({ goals }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Objectifs en cours</div>
          <div className="card-sub">Top épargnants · proche du palier</div>
        </div>
        <span className="card-action">Tous <I.Arrow size={12}/></span>
      </div>
      <div style={{ padding: "4px 18px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {goals.map((g, i) => (
          <div key={i}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ fontWeight: 550 }}>{g.client}</span>
              <span style={{ color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                <strong style={{ color: "var(--ink)" }}>{fmt(g.current)}</strong> / {fmt(g.target)} FCFA
              </span>
            </div>
            <div className="goal-bar"><div className="goal-fill" style={{ width: g.pct + "%" }} /></div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}>{g.pct}% atteint</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Dashboard activity feed. */
export function ActivityCard({ feed }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Activité</div>
          <div className="card-sub">Fil d'événements de l'agence</div>
        </div>
        <button className="btn ghost sm"><I.Filter size={12}/>Filtrer</button>
      </div>
      <div className="feed">
        {feed.map((f, i) => (
          <div className="feed-item" key={i}>
            <div className={"feed-dot " + (f.dot === "muted" ? "muted" : f.dot === "info" ? "info" : "")}></div>
            <div>
              <div className="feed-text">{f.text}</div>
              <div className="feed-time">{f.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Dashboard shortcut buttons. */
export function QuickActionsCard() {
  const actions = [
    { ic: <I.Plus />,    label: "Dépôt rapide",   sub: "Carnet d'épargne" },
    { ic: <I.ArrowUp />, label: "Retrait",         sub: "Validation requise" },
    { ic: <I.Users />,   label: "Inscrire client", sub: "KYC en 3 étapes" },
    { ic: <I.Cloud />,   label: "Synchroniser",    sub: "4 en file" },
  ]
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Actions rapides</div>
        <span className="card-sub" style={{ marginLeft: "auto" }}>⌘ + raccourci</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "4px 14px 16px" }}>
        {actions.map((a, i) => (
          <button key={i} className="btn" style={{
            justifyContent: "flex-start", textAlign: "left",
            padding: "11px 12px", height: "auto", flexDirection: "column", alignItems: "flex-start",
            gap: 6, borderRadius: 10
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: 7, background: "var(--brand-softer)",
              display: "grid", placeItems: "center", color: "var(--brand-ink)"
            }}>
              {/* clone icon with size=14 */}
              {a.label === "Dépôt rapide"   && <I.Plus size={14} />}
              {a.label === "Retrait"         && <I.ArrowUp size={14} />}
              {a.label === "Inscrire client" && <I.Users size={14} />}
              {a.label === "Synchroniser"    && <I.Cloud size={14} />}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontWeight: 550, fontSize: 13 }}>{a.label}</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 400 }}>{a.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
