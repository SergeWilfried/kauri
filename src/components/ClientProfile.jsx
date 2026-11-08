import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { errorMessage } from '../components'

// Labels for the values stored in customers.metadata (convex/customers.ts)
const GENDER = { F: "Femme", M: "Homme" }
const MARITAL = {
  celibataire: "Célibataire", marie: "Marié(e)", union: "Union libre",
  divorce: "Divorcé(e)", veuf: "Veuf / veuve",
}
const ACTIVITY = {
  commerce: "Commerce / boutique", restauration: "Restauration", agriculture: "Agriculture",
  elevage: "Élevage", artisanat: "Artisanat", transport: "Transport", services: "Services",
  salarie: "Salarié(e)", autre: "Autre",
}

const thisYear = new Date().getFullYear()
const Missing = () => <span className="cell-sub">Non renseigné</span>

/** Read-only value for a profile field. */
function ProfileValue({ field, p }) {
  switch (field) {
    case "gender": return p.gender ? GENDER[p.gender] : <Missing/>
    case "age": return p.birthYear ? `${thisYear - p.birthYear} ans (né·e en ${p.birthYear})` : <Missing/>
    case "maritalStatus": return p.maritalStatus ? MARITAL[p.maritalStatus] : <Missing/>
    case "children": return p.children === null ? <Missing/> : p.children === 0 ? "Aucun" : `${p.children} enfant${p.children > 1 ? "s" : ""}`
    case "activity": return p.activityType || p.activity
      ? [p.activityType && ACTIVITY[p.activityType], p.activity].filter(Boolean).join(" · ")
      : <Missing/>
    case "address": return p.address || <Missing/>
    default: return null
  }
}

const FIELDS = [
  ["gender", "Sexe"], ["age", "Âge"], ["maritalStatus", "Situation familiale"], ["children", "Enfants"],
  ["activity", "Activité", true], ["address", "Adresse", true],
]

/**
 * The client's personal profile (sex, age, family, activity, address) in the
 * client drawer. Staff allowed to edit customers (customers:create_prospect)
 * can change it in place; empty fields are cleared.
 */
export default function ClientProfile({ client }) {
  const me = useQuery(api.users.me)
  const update = useMutation(api.customers.update)
  const p = client.profile ?? {}
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const start = () => {
    setForm({
      gender: p.gender ?? "", birthYear: p.birthYear ?? "", maritalStatus: p.maritalStatus ?? "",
      children: p.children ?? "", activityType: p.activityType ?? "", activity: p.activity ?? "",
      address: p.address ?? "",
    })
    setError(null); setEditing(true)
  }
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const num = (s) => (s === "" ? null : Number(s))

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await update({ id: client.id, metadata: {
        gender: form.gender, maritalStatus: form.maritalStatus, activityType: form.activityType,
        birthYear: num(form.birthYear), children: num(form.children),
        activity: form.activity, address: form.address.trim(),
      } })
      setEditing(false)
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }

  return (
    <section className="drawer-section" aria-labelledby="client-profile-title">
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: 8 }}>
        <div id="client-profile-title" className="card-title">Profil</div>
        {me?.can?.editCustomers && !editing && (
          <button className="btn ghost sm" style={{ marginLeft: "auto", padding: "2px 8px" }} onClick={start}>Modifier</button>
        )}
      </div>

      {!editing ? (
        <dl className="field-grid">
          {FIELDS.map(([k, label, wide]) => (
            <div key={k} className={wide ? "span-2" : undefined}><dt>{label}</dt><dd><ProfileValue field={k} p={p}/></dd></div>
          ))}
        </dl>
      ) : (
        <form onSubmit={save} className="field-grid profile-form">
          <label><span>Sexe</span>
            <select className="input" value={form.gender} onChange={set("gender")}>
              <option value="">—</option>{Object.entries(GENDER).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label><span>Année de naissance</span>
            <input className="input" type="number" inputMode="numeric" min={thisYear - 110} max={thisYear - 15}
              placeholder="ex. 1985" value={form.birthYear} onChange={set("birthYear")}/>
          </label>
          <label><span>Situation familiale</span>
            <select className="input" value={form.maritalStatus} onChange={set("maritalStatus")}>
              <option value="">—</option>{Object.entries(MARITAL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label><span>Nombre d'enfants</span>
            <input className="input" type="number" inputMode="numeric" min={0} max={30} value={form.children} onChange={set("children")}/>
          </label>
          <label><span>Type d'activité</span>
            <select className="input" value={form.activityType} onChange={set("activityType")}>
              <option value="">—</option>{Object.entries(ACTIVITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label><span>Précision</span>
            <input className="input" maxLength={120} placeholder="ex. boutique alimentaire, marché central" value={form.activity} onChange={set("activity")}/>
          </label>
          <label className="span-2"><span>Adresse</span>
            <input className="input" maxLength={200} value={form.address} onChange={set("address")}/>
          </label>
          {error && <div role="alert" className="span-2" style={{ color: "var(--neg)", fontSize: 12 }}>{error}</div>}
          <div className="span-2" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn sm" onClick={() => setEditing(false)} disabled={busy}>Annuler</button>
            <button type="submit" className="btn brand sm" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
          </div>
        </form>
      )}
    </section>
  )
}
