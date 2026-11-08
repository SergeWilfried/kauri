import { useState, useMemo } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { I } from '../icons'
import { downloadCsv, errorMessage, fmt, KPI, PageHeader, PageSkeleton, SearchInput } from '../components'
import { Pager, usePaged } from '../components/Pager'
import { useDialog } from '../components/useDialog'

const PRODUCT_FAMILIES = [
  { k: "epargne",   label: "Épargne",        color: "var(--brand)",         icon: "Wallet" },
  { k: "credit",    label: "Crédit",         color: "oklch(0.55 0.13 280)", icon: "Coin"   },
  { k: "tontine",   label: "Tontine",        color: "oklch(0.6 0.13 130)",  icon: "Users"  },
  { k: "assurance", label: "Microassurance", color: "oklch(0.6 0.11 230)",  icon: "Shield" },
]

const ALL_TARGETS = ["Particuliers", "TPE", "Commerçants", "Agriculteurs", "Coopératives", "Familles", "Groupes", "Parents"]
const KYC_LEVELS = ["Allégée", "Standard", "Renforcée"]
// Partner apps that can sell a product through the API (convex/channelApi.ts)
const ALL_CHANNELS = [{ k: "nafa", label: "Nafa" }]

const STATUS_META = {
  actif:     { label: "Actif",     class: "actif"   },
  brouillon: { label: "Brouillon", class: "attente" },
  archive:   { label: "Archivé",   class: "archive" },
}

function familyMeta(k) { return PRODUCT_FAMILIES.find(f => f.k === k) || PRODUCT_FAMILIES[0] }

// Fields saveProduct takes (the rest of a row is computed by the server)
const PRODUCT_FIELDS = ["code", "name", "family", "summary", "status", "rate", "durationMin", "durationMax",
  "minDeposit", "maxBalance", "fees", "feesUnit", "grace", "kycLevel", "targets", "branchIds", "channels"]

function blankProduct(branchId) {
  return {
    id: null, code: "", name: "", family: "epargne", summary: "",
    status: "brouillon",
    rate: 0, durationMin: 0, durationMax: 0,
    minDeposit: 1000, maxBalance: 0,
    fees: 0, feesUnit: "FCFA", grace: 0,
    kycLevel: "Standard",
    targets: ["Particuliers"],
    branchIds: branchId ? [branchId] : [],
    channels: [],
  }
}

/** Product catalogue of the organization, with uptake among the branch's clients. */
export default function ProductsPage() {
  const data = useQuery(api.portfolio.listProducts)
  const me = useQuery(api.users.me)
  const canEdit = !!me?.can?.managePortfolio
  const products = useMemo(() => data?.products ?? [], [data])
  const [q, setQ] = useState("")
  const [seg, setSeg] = useState("tous")
  const [fam, setFam] = useState("toutes")
  const [view, setView] = useState("cards")
  const [editor, setEditor] = useState(null)

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (seg !== "tous" && p.status !== seg) return false
      if (fam !== "toutes" && p.family !== fam) return false
      if (q && !p.name.toLowerCase().includes(q.toLowerCase()) && !p.code.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [products, q, seg, fam])

  const counts = {
    tous: products.length,
    actif: products.filter(p => p.status === "actif").length,
    brouillon: products.filter(p => p.status === "brouillon").length,
    archive: products.filter(p => p.status === "archive").length,
  }

  const totalClients = products.reduce((s, p) => s + p.clients, 0)
  const totalEncours = products.reduce((s, p) => s + p.encours, 0)
  const opened30 = products.reduce((s, p) => s + p.opened30, 0)

  const paged = usePaged(filtered)
  const usedFamilies = new Set(products.filter(p => p.status === "actif").map(p => p.family)).size

  const kpis = [
    { label: "Produits actifs",  value: String(counts.actif), unit: `/ ${counts.tous}`, note: `${counts.brouillon} en brouillon`, icon: "wallet" },
    { label: "Encours",          value: fmt(totalEncours),    unit: "FCFA", note: "clients de l'agence", icon: "coin" },
    { label: "Clients équipés",  value: String(totalClients), unit: "clients", note: `dont ${opened30} inscrits ces 30 j`, icon: "users" },
    { label: "Familles",         value: String(usedFamilies), unit: `/ ${PRODUCT_FAMILIES.length}`, note: "avec un produit actif", icon: "receipt" },
  ]

  const onDuplicate = (p) => setEditor({
    mode: "create",
    product: { ...p, id: null, code: (p.code + "-2").slice(0, 20), name: p.name + " (copie)", status: "brouillon" },
  })

  const exportCsv = () => downloadCsv(
    "produits.csv",
    ["Code", "Nom", "Famille", "Statut", "Taux (%)", "Durée min (mois)", "Durée max (mois)", "Dépôt min (FCFA)",
     "Plafond (FCFA)", "Frais", "Unité frais", "Grâce (j)", "KYC", "Agences", "Cibles", "Clients", "Encours (FCFA)"],
    filtered.map(p => [p.code, p.name, familyMeta(p.family).label, STATUS_META[p.status].label, p.rate, p.durationMin,
      p.durationMax, p.minDeposit, p.maxBalance, p.fees, p.feesUnit, p.grace, p.kycLevel, p.branches.join(", "),
      p.targets.join(", "), p.clients, p.encours]),
  )

  if (data === undefined) {
    return (
      <div className="products-page">
        <PageHeader crumbs={["Produits"]} title="Catalogue de produits" />
        <PageSkeleton />
      </div>
    )
  }

  return (
    <div className="products-page">
      <PageHeader crumbs={["Produits"]} title="Catalogue de produits">

      </PageHeader>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <SearchInput placeholder="Nom ou code…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn" onClick={exportCsv} disabled={filtered.length === 0}><I.Export size={14}/>Exporter</button>
        {canEdit && (
          <button className="btn brand" onClick={() => setEditor({ mode: "create", product: blankProduct(me?.branchId) })}>
            <I.Plus size={14} stroke="white"/>Nouveau produit
          </button>
        )}
      </div>
      <section className="kpi-row">
        {kpis.map(k => <KPI key={k.label} k={k}/>)}
      </section>

      <section className="family-band">
        {PRODUCT_FAMILIES.map(f => {
          const ps = products.filter(p => p.family === f.k)
          const enc = ps.reduce((s, p) => s + p.encours, 0)
          const Ic = I[f.icon]
          return (
            <button key={f.k}
                    aria-pressed={fam === f.k} className={"family-tile " + (fam === f.k ? "on" : "")}
                    onClick={() => setFam(fam === f.k ? "toutes" : f.k)}>
              <span className="family-icon" style={{ background: f.color }}>
                <Ic size={16} stroke="white"/>
              </span>
              <span className="family-text">
                <span className="family-name">{f.label}</span>
                <span className="family-sub">{ps.length} produits · {fmt(enc)} FCFA</span>
              </span>
              <I.Arrow size={12}/>
            </button>
          )
        })}
      </section>
      
      
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="filter-bar">
          <div className="seg-tabs">
            {[
              { k: "tous",      label: "Tous",      n: counts.tous },
              { k: "actif",     label: "Actifs",    n: counts.actif },
              { k: "brouillon", label: "Brouillons",n: counts.brouillon },
              { k: "archive",   label: "Archivés",  n: counts.archive },
            ].map(t => (
              <button key={t.k} aria-pressed={seg === t.k} className={"seg-tab " + (seg === t.k ? "on" : "")} onClick={() => setSeg(t.k)}>
                {t.label}<span className="seg-count">{t.n}</span>
              </button>
            ))}
          </div>
          <div className="filter-spacer"/>
          <label className="filter-group">
            <span className="filter-label">Famille</span>
            <select className="filter-select" value={fam} onChange={e => setFam(e.target.value)}>
              <option value="toutes">Toutes</option>
              {PRODUCT_FAMILIES.map(f => <option key={f.k} value={f.k}>{f.label}</option>)}
            </select>
          </label>
          <div className="seg">
            <button aria-pressed={view === "cards"} className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>Cartes</button>
            <button aria-pressed={view === "table"} className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Tableau</button>
          </div>
        </div>

        {view === "cards" ? (
          <div className="prod-grid">
            {paged.rows.map(p => (
              <ProductCard key={p.id} p={p} canEdit={canEdit}
                onEdit={() => setEditor({ mode: "edit", product: p })}
                onDuplicate={() => onDuplicate(p)}
              />
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)", fontSize: 13, gridColumn: "1/-1" }}>
                {products.length === 0
                  ? canEdit ? "Le catalogue est vide : créez le premier produit." : "Le catalogue est vide."
                  : "Aucun produit ne correspond aux filtres."}
              </div>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Famille</th>
                  <th style={{ textAlign: "right" }}>Taux</th>
                  <th style={{ textAlign: "right" }}>Plafond</th>
                  <th style={{ textAlign: "right" }}>Clients</th>
                  <th style={{ textAlign: "right" }}>Encours</th>
                  <th>Statut</th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map(p => {
                  const f = familyMeta(p.family)
                  const sm = STATUS_META[p.status]
                  const Ic = I[f.icon]
                  return (
                    <tr key={p.id} onClick={() => setEditor({ mode: "edit", product: p })}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="prod-glyph" style={{ background: f.color }}><Ic size={13} stroke="white"/></span>
                          <div>
                            <div style={{ fontWeight: 550 }}>{p.name}</div>
                            <div className="cell-sub" style={{ fontFamily: "var(--font-mono)" }}>{p.code}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="chip">{f.label}</span></td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {p.rate > 0 ? `${p.rate} %` : "—"}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink-2)" }}>
                        {p.maxBalance ? fmt(p.maxBalance) : "—"}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.clients}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 550 }}>
                        {fmt(p.encours)}<span className="cell-sub" style={{ marginLeft: 4 }}>FCFA</span>
                      </td>
                      <td><span className={"tag " + sm.class}>{sm.label}</span></td>
                      <td>
                        <button className="btn ghost sm" style={{ padding: 4 }} aria-label={`${canEdit ? "Modifier" : "Voir"} ${p.name}`}
                          onClick={e => { e.stopPropagation(); setEditor({ mode: "edit", product: p }) }}>
                          <I.Arrow size={12}/>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* One pager for both views */}
        <Pager paged={paged} unit="produits" />
      </div>

      {editor && (
        <ProductEditor
          mode={editor.mode}
          initial={editor.product}
          branches={data.branches}
          readOnly={!canEdit}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}

function ProductCard({ p, canEdit, onEdit, onDuplicate }) {
  const f = familyMeta(p.family)
  const sm = STATUS_META[p.status]
  const Ic = I[f.icon]
  const dur = p.durationMin === 0 && p.durationMax === 0 ? "Libre"
    : p.durationMin === p.durationMax ? `${p.durationMin} mois`
    : `${p.durationMin}–${p.durationMax} mois`
  return (
    <div className="prod-card" onClick={onEdit}>
      <div className="prod-card-top">
        <span className="prod-glyph lg" style={{ background: f.color }}><Ic size={18} stroke="white"/></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="prod-name">{p.name}</div>
          <div className="cell-sub" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.01em" }}>{p.code}</div>
        </div>
        <span className={"tag " + sm.class}>{sm.label}</span>
      </div>

      <div className="prod-summary">{p.summary}</div>

      <div className="prod-stats">
        <div>
          <div className="cell-sub">Taux</div>
          <div className="prod-stat-v">{p.rate > 0 ? p.rate : "—"}<span className="u">{p.rate > 0 ? "% / an" : ""}</span></div>
        </div>
        <div>
          <div className="cell-sub">Durée</div>
          <div className="prod-stat-v">{dur}</div>
        </div>
        <div>
          <div className="cell-sub">Min. ouverture</div>
          <div className="prod-stat-v">{fmt(p.minDeposit)}<span className="u">FCFA</span></div>
        </div>
      </div>

      <div className="prod-foot">
        <div className="prod-usage">
          <I.Users size={12}/> <strong>{p.clients}</strong> clients · <strong>{fmt(p.encours)}</strong> FCFA
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn ghost sm" onClick={e => { e.stopPropagation(); onDuplicate() }} title="Dupliquer">
              <I.Folder size={12}/>
            </button>
            <button className="btn sm" onClick={e => { e.stopPropagation(); onEdit() }}>Modifier</button>
          </div>
        )}
      </div>
    </div>
  )
}

const EDITOR_TABS = [
  { k: "identite",     label: "Identité",      icon: "Receipt" },
  { k: "conditions",   label: "Conditions",    icon: "Coin" },
  { k: "distribution", label: "Distribution",  icon: "Users" },
  { k: "apercu",       label: "Aperçu",        icon: "Star" },
]

function ProductEditor({ mode, initial, branches, readOnly, onClose }) {
  const [tab, setTab] = useState("identite")
  const [p, setP] = useState({ ...initial })
  const isNew = mode === "create"
  const saveProduct = useMutation(api.portfolio.saveProduct)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const branchName = (id) => branches.find(b => b.id === id)?.name ?? "—"
  const ref = useDialog(onClose)

  const onSave = async (product) => {
    setBusy(true)
    setError("")
    try {
      const args = Object.fromEntries(PRODUCT_FIELDS.map(k => [k, product[k]]))
      await saveProduct(isNew ? args : { id: product.id, ...args })
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const set = (k, v) => setP(prev => ({ ...prev, [k]: v }))

  const toggleArr = (k, v) => setP(prev => {
    const arr = prev[k] || []
    return { ...prev, [k]: arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v] }
  })

  const f = familyMeta(p.family)
  const Ic = I[f.icon]

  const dur = p.durationMin === 0 && p.durationMax === 0 ? "Libre"
    : p.durationMin === p.durationMax ? `${p.durationMin} mois`
    : `${p.durationMin}–${p.durationMax} mois`

  return (
    <>
      <div className="drawer-scrim" onClick={onClose}/>
      <div className="drawer prod-drawer" role="dialog" aria-modal="true" aria-label={isNew ? "Nouveau produit" : p.name} ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {isNew ? "Nouveau produit" : p.name}
            </div>
            <div className="cell-sub">{isNew ? "Créer un produit financier" : `Code : ${p.code}`}</div>
          </div>
          <button className="btn ghost sm" onClick={onClose} aria-label="Fermer"><I.Plus size={14} style={{ transform: "rotate(45deg)" }}/></button>
        </div>

        <div className="prod-tabs">
          {EDITOR_TABS.map(t => {
            const TIc = I[t.icon]
            return (
              <button key={t.k} type="button" aria-pressed={tab === t.k} className={"prod-tab " + (tab === t.k ? "on" : "")} onClick={() => setTab(t.k)}>
                <TIc size={14}/>{t.label}
              </button>
            )
          })}
        </div>

        <div className="drawer-body">
          {tab === "identite" && (
            <>
              <div className="field" role="group" aria-label="Famille">
                <span className="field-label">Famille</span>
                <div className="family-radio">
                  {PRODUCT_FAMILIES.map(fam => {
                    const FIc = I[fam.icon]
                    return (
                      <button key={fam.k} type="button" aria-pressed={p.family === fam.k} className={"family-radio-tile " + (p.family === fam.k ? "on" : "")}
                              onClick={() => set("family", fam.k)}>
                        <span className="prod-glyph" style={{ background: fam.color, width: 26, height: 26 }}>
                          <FIc size={13} stroke="white"/>
                        </span>
                        {fam.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <label className="field">
                <span className="field-label">Nom du produit</span>
                <input className="input" value={p.name} onChange={e => set("name", e.target.value)} placeholder="Ex : Épargne solidaire"/>
              </label>

              <label className="field">
                <span className="field-label">Code interne</span>
                <input className="input" value={p.code} onChange={e => set("code", e.target.value.toUpperCase())} placeholder="Ex : SOLID-01" style={{ fontFamily: "var(--font-mono)" }}/>
              </label>

              <label className="field">
                <span className="field-label">Description courte</span>
                <textarea className="input" value={p.summary} onChange={e => set("summary", e.target.value)} placeholder="Résumé visible sur la carte produit…"/>
              </label>

              <label className="field">
                <span className="field-label">Statut</span>
                <select className="input" value={p.status} onChange={e => set("status", e.target.value)}>
                  <option value="brouillon">Brouillon</option>
                  <option value="actif">Actif</option>
                  <option value="archive">Archivé</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">Niveau KYC requis</span>
                <select className="input" value={p.kycLevel} onChange={e => set("kycLevel", e.target.value)}>
                  {KYC_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            </>
          )}

          {tab === "conditions" && (
            <>
              <label className="field">
                <span className="field-label">Taux d'intérêt annuel (%)</span>
                <input className="input" type="number" min="0" step="0.1" value={p.rate}
                       onChange={e => set("rate", parseFloat(e.target.value) || 0)}/>
              </label>

              <div className="field" role="group" aria-label="Durée (mois)">
                <span className="field-label">Durée (mois)</span>
                <div className="dur-row">
                  <div className="input-row">
                    <input className="input" type="number" min="0" placeholder="Min" aria-label="Durée minimum (mois)" value={p.durationMin}
                           onChange={e => set("durationMin", parseInt(e.target.value) || 0)}/>
                    <span style={{ color: "var(--ink-3)" }}>—</span>
                    <input className="input" type="number" min="0" placeholder="Max" aria-label="Durée maximum (mois)" value={p.durationMax}
                           onChange={e => set("durationMax", parseInt(e.target.value) || 0)}/>
                  </div>
                  <span className="chip">{dur}</span>
                </div>
                <div className="cell-sub" style={{ marginTop: 4 }}>Mettre 0 / 0 pour une durée libre.</div>
              </div>

              <label className="field">
                <span className="field-label">Dépôt minimum d'ouverture (FCFA)</span>
                <input className="input" type="number" min="0" value={p.minDeposit}
                       onChange={e => set("minDeposit", parseInt(e.target.value) || 0)}/>
              </label>

              <label className="field">
                <span className="field-label">Plafond de solde (FCFA — 0 = illimité)</span>
                <input className="input" type="number" min="0" value={p.maxBalance}
                       onChange={e => set("maxBalance", parseInt(e.target.value) || 0)}/>
              </label>

              <div className="field" role="group" aria-label="Frais d'ouverture">
                <span className="field-label">Frais d'ouverture</span>
                <div className="input-row">
                  <input className="input" type="number" min="0" step="0.1" value={p.fees} aria-label="Montant des frais"
                         onChange={e => set("fees", parseFloat(e.target.value) || 0)}/>
                  <select className="input" style={{ width: 90 }} aria-label="Unité des frais" value={p.feesUnit} onChange={e => set("feesUnit", e.target.value)}>
                    <option value="FCFA">FCFA</option>
                    <option value="%">%</option>
                  </select>
                </div>
              </div>

              <label className="field">
                <span className="field-label">Délai de grâce (jours)</span>
                <input className="input" type="number" min="0" value={p.grace}
                       onChange={e => set("grace", parseInt(e.target.value) || 0)}/>
              </label>
            </>
          )}

          {tab === "distribution" && (
            <>
              <div className="field" role="group" aria-label="Agences habilitées">
                <span className="field-label">Agences habilitées</span>
                <div className="chip-picker">
                  {branches.map(b => (
                    <button key={b.id} type="button" aria-pressed={p.branchIds.includes(b.id)} className={"chip-pick " + (p.branchIds.includes(b.id) ? "on" : "")}
                            onClick={() => toggleArr("branchIds", b.id)}>
                      {p.branchIds.includes(b.id) && <I.Check size={12}/>}{b.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field" role="group" aria-label="Cibles clients">
                <span className="field-label">Cibles clients</span>
                <div className="chip-picker">
                  {ALL_TARGETS.map(t => (
                    <button key={t} type="button" aria-pressed={p.targets.includes(t)} className={"chip-pick " + (p.targets.includes(t) ? "on" : "")}
                            onClick={() => toggleArr("targets", t)}>
                      {p.targets.includes(t) && <I.Check size={12}/>}{t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field" role="group" aria-label="Applications partenaires">
                <span className="field-label">Applications partenaires</span>
                <div className="chip-picker">
                  {ALL_CHANNELS.map(c => (
                    <button key={c.k} type="button" aria-pressed={p.channels.includes(c.k)} className={"chip-pick " + (p.channels.includes(c.k) ? "on" : "")}
                            onClick={() => toggleArr("channels", c.k)}>
                      {p.channels.includes(c.k) && <I.Check size={12}/>}{c.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === "apercu" && (
            <>
              <div className="preview-card">
                <div className="prod-card-top">
                  <span className="prod-glyph lg" style={{ background: f.color }}><Ic size={18} stroke="white"/></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="prod-name">{p.name || "Nom du produit"}</div>
                    <div className="cell-sub" style={{ fontFamily: "var(--font-mono)" }}>{p.code || "CODE"}</div>
                  </div>
                  <span className={"tag " + STATUS_META[p.status].class}>{STATUS_META[p.status].label}</span>
                </div>
                <div className="prod-summary" style={{ WebkitLineClamp: "unset" }}>{p.summary || "—"}</div>
                <div className="prod-stats">
                  <div>
                    <div className="cell-sub">Taux</div>
                    <div className="prod-stat-v">{p.rate > 0 ? p.rate : "—"}<span className="u">{p.rate > 0 ? "% / an" : ""}</span></div>
                  </div>
                  <div>
                    <div className="cell-sub">Durée</div>
                    <div className="prod-stat-v">{dur}</div>
                  </div>
                  <div>
                    <div className="cell-sub">Min. ouverture</div>
                    <div className="prod-stat-v">{fmt(p.minDeposit)}<span className="u">FCFA</span></div>
                  </div>
                </div>
              </div>

              <div className="example-box">
                <div className="cell-sub" style={{ marginBottom: 8 }}>Résumé des conditions</div>
                <dl className="info-list">
                  <dt>Famille</dt><dd>{f.label}</dd>
                  <dt>KYC requis</dt><dd>{p.kycLevel}</dd>
                  <dt>Frais</dt><dd>{p.fees > 0 ? `${p.fees} ${p.feesUnit}` : "Aucun"}</dd>
                  <dt>Délai de grâce</dt><dd>{p.grace > 0 ? `${p.grace} j` : "—"}</dd>
                  <dt>Plafond</dt><dd>{p.maxBalance ? `${fmt(p.maxBalance)} FCFA` : "Illimité"}</dd>
                  <dt>Agences</dt><dd>{p.branchIds.map(branchName).join(", ") || "—"}</dd>
                  <dt>Cibles</dt><dd>{p.targets.join(", ") || "—"}</dd>
                  <dt>Partenaires</dt><dd>{p.channels.map(k => ALL_CHANNELS.find(c => c.k === k)?.label ?? k).join(", ") || "—"}</dd>
                </dl>
              </div>
            </>
          )}
        </div>

        {error && <div role="alert" style={{ color: "var(--neg)", fontSize: 12.5, padding: "0 20px 8px" }}>{error}</div>}
        <div className="drawer-foot">
          {readOnly ? (
            <button className="btn" onClick={onClose}>Fermer</button>
          ) : (
            <>
              <button className="btn brand" disabled={busy} onClick={() => onSave(p)}>
                <I.Check size={14} stroke="white"/>{isNew ? "Créer le produit" : "Enregistrer"}
              </button>
              <button className="btn" onClick={onClose}>Annuler</button>
              {!isNew && p.status !== "archive" && (
                <button className="btn ghost sm" style={{ marginLeft: "auto", color: "var(--neg)" }} disabled={busy}
                        onClick={() => onSave({ ...initial, status: "archive" })}>
                  Archiver
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
