import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { I } from '../icons'
import { errorMessage, initials, Loading } from '../components'
import { useDialog } from './useDialog'

export const ROLE_OPTIONS = [
  { value: "field_agent", label: "Agent terrain" },
  { value: "supervisor",  label: "Superviseur" },
  { value: "accountant",  label: "Comptable" },
  { value: "it_admin",    label: "Admin IT" },
]

/** Side drawer shell with title, scrim, optional avatar and badges next to the title, and optional footer. */
function Drawer({ title, sub, onClose, children, foot, avatar, badges }) {
  const ref = useDialog(onClose)
  return (
    <>
      <div className="drawer-scrim" onClick={onClose}/>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            {avatar}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 18, letterSpacing: "-0.015em" }}>{title}</span>
                {badges}
              </div>
              {sub && <div className="cell-sub" style={{ marginTop: 2 }}>{sub}</div>}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose} style={{ padding: 6 }} aria-label="Fermer">✕</button>
        </div>
        <div className="drawer-body">{children}</div>
        {foot && <div className="drawer-foot">{foot}</div>}
      </aside>
    </>
  )
}

/**
 * Create a staff row and role. Activation happens next, from the staff drawer. Calls `onCreated(userId)` on success.
 */
export function NewStaffDrawer({ onClose, onCreated }) {
  const branches = useQuery(api.staff.listBranches)
  const create   = useMutation(api.staff.create)
  const [form, setForm]   = useState({ fullName: "", email: "", phoneNumber: "", branchId: "", role: "field_agent" })
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { onCreated(await create(form)) }
    catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }

  return (
    <Drawer title="Nouveau membre du personnel" sub="Le compte sera activé avec un code à usage unique." onClose={onClose}>
      <form id="new-staff" onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className="field">
          <span className="field-label">Nom complet</span>
          <input className="input" required value={form.fullName} onChange={set("fullName")} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Email professionnel</span>
          <input className="input" type="email" required value={form.email} onChange={set("email")} placeholder="prenom.nom@exemple.bf" />
        </label>
        <label className="field">
          <span className="field-label">Téléphone</span>
          <input className="input" type="tel" required value={form.phoneNumber} onChange={set("phoneNumber")} placeholder="+226 …" />
        </label>
        <label className="field">
          <span className="field-label">Agence</span>
          <select className="input" required value={form.branchId} onChange={set("branchId")}>
            <option value="">{branches === undefined ? "Chargement…" : "Choisir une agence…"}</option>
            {(branches ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Rôle</span>
          <select className="input" value={form.role} onChange={set("role")}>
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        {error && <div role="alert" style={{ color: "var(--neg)", fontSize: 12.5 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn brand" disabled={busy}>
            <I.Plus size={14} stroke="white"/>{busy ? "Création…" : "Créer le compte"}
          </button>
        </div>
      </form>
    </Drawer>
  )
}

/**
 * Details (name, email, phone, branch) and role, saved together with one
 * Enregistrer / Annuler bar that appears once something changed; then the
 * activation or password reset code and suspension. Role and status are
 * locked on the admin's own account; details can be edited on it.
 */
export function StaffDrawer({ userId, onClose }) {
  const staff     = useQuery(api.staff.get, { userId })
  const branches  = useQuery(api.staff.listBranches)
  const update    = useMutation(api.staff.update)
  const setRole   = useMutation(api.staff.setRole)
  const setStatus = useMutation(api.staff.setStatus)
  const issueActivation = useMutation(api.staff.issueActivationCode)
  const issueReset      = useMutation(api.staff.issueResetCode)
  const [draft, setDraft]   = useState({}) // edited fields only
  const [saved, setSaved]   = useState(false)
  const [issued, setIssued]  = useState(null) // { code, expiresAt }: shown once
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  if (staff === undefined) return <Drawer title="…" onClose={onClose}><Loading /></Drawer>
  if (staff === null) return <Drawer title="Introuvable" onClose={onClose}><div className="cell-sub">Ce compte n'existe plus.</div></Drawer>

  const currentRole = staff.roles[0] ?? ""
  const initial = {
    fullName: staff.name, email: staff.email, phoneNumber: staff.phone ?? "",
    branchId: staff.branchId, role: currentRole,
  }
  const values  = { ...initial, ...draft }
  const changed = Object.keys(draft).filter(k => draft[k] !== initial[k])
  const dirty   = changed.length > 0
  // Locked while saving, so nothing typed meanwhile is lost when the draft clears
  const field   = (k) => ({
    value: values[k],
    disabled: busy,
    onChange: (e) => { setSaved(false); setDraft(d => ({ ...d, [k]: e.target.value })) },
  })
  const suspended   = staff.status !== "active"
  const locked      = staff.isSelf

  const run = async (fn) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  // Activation for a new account, reset once a password exists: same one-time code
  const reset     = staff.activated
  const issueCode = reset ? issueReset : issueActivation
  const screen    = reset ? "Mot de passe oublié" : "Première connexion"
  const discard = () => { setDraft({}); setError(null) }
  const save = (e) => {
    e?.preventDefault()
    run(async () => {
      const details = Object.fromEntries(changed.filter(k => k !== "role").map(k => [k, values[k]]))
      if (Object.keys(details).length) await update({ userId, ...details })
      if (changed.includes("role") && values.role) await setRole({ userId, role: values.role })
      setDraft({}); setSaved(true)
    })
  }
  const contactChanged = staff.activated && (changed.includes("email") || changed.includes("phoneNumber"))

  const copy = async () => {
    try { await navigator.clipboard.writeText(issued.code); setCopied(true) } catch { /* clipboard blocked */ }
  }

  return (
    <Drawer title={staff.name} sub={`${staff.email} · ${staff.branch}`} onClose={onClose}
      avatar={<div className="avatar lg">{initials(staff.name)}</div>}
      badges={<>
        <span className={"tag " + (suspended ? "archive" : "actif")}>{suspended ? "Suspendu" : "Actif"}</span>
        <span className={"tag " + (staff.activated ? "actif" : "attente")}>{staff.activated ? "Activé" : "Non activé"}</span>
      </>}
      foot={dirty ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <span className="cell-sub" style={{ marginRight: "auto" }}>
            {changed.length} modification{changed.length > 1 ? "s" : ""} non enregistrée{changed.length > 1 ? "s" : ""}
          </span>
          <button className="btn" onClick={discard} disabled={busy}>Annuler</button>
          <button className="btn brand" type="submit" form="staff-edit" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      ) : null}>
      {locked && (
        <div className="cell-sub" style={{ padding: "10px 12px", background: "var(--surface-2)", borderRadius: 8 }}>
          C'est votre propre compte : un autre Admin IT doit modifier votre rôle ou votre statut.
        </div>
      )}

      <form id="staff-edit" className="drawer-section" onSubmit={save}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="card-title">Informations</div>
        <label className="field">
          <span className="field-label">Nom complet</span>
          <input className="input" required {...field("fullName")} />
        </label>
        <label className="field">
          <span className="field-label">Email professionnel</span>
          <input className="input" type="email" required {...field("email")} />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="field">
            <span className="field-label">Téléphone</span>
            <input className="input" type="tel" required placeholder="+226 …" {...field("phoneNumber")} />
          </label>
          <label className="field">
            <span className="field-label">Agence</span>
            <select className="input" required {...field("branchId")}>
              {(branches ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">Rôle</span>
          <select className="input" {...field("role")} disabled={locked || busy}>
            {!currentRole && <option value="">Aucun rôle</option>}
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        {contactChanged && (
          <div className="cell-sub">
            Le mot de passe ne change pas : la personne se connecte avec le nouvel email ou le nouveau numéro.
            Sur l&apos;application, un nouveau numéro demande de choisir à nouveau le code PIN.
          </div>
        )}
        {saved && !dirty && <div className="cell-sub" role="status">Modifications enregistrées.</div>}
      </form>

      <div className="drawer-section">
        <div className="card-title" style={{ marginBottom: 10 }}>{reset ? "Mot de passe" : "Activation"}</div>
        {issued ? (
          <div style={{ padding: 14, borderRadius: 10, background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="cell-sub">Transmettez ce code à {staff.name.split(" ")[0]}. Il ne sera plus affiché.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 600, letterSpacing: "0.12em" }}>{issued.code}</span>
              <button className="btn sm" onClick={copy}>{copied ? <><I.Check size={12}/>Copié</> : "Copier"}</button>
            </div>
            <div className="cell-sub">
              Valable jusqu'au {new Date(issued.expiresAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · usage unique ·
              écran « {screen} »
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            <div className="cell-sub">
              {staff.codePendingUntil
                ? `Un code est en attente jusqu'au ${new Date(staff.codePendingUntil).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}. En générer un nouveau annule le précédent.`
                : reset
                  ? "Le mot de passe a été défini. En cas d'oubli, générez un code de réinitialisation : l'ancien mot de passe reste valable jusqu'à son utilisation."
                  : "Aucun code en cours. Générez-en un pour que la personne puisse choisir son mot de passe."}
            </div>
            <button className={"btn " + (reset ? "" : "brand")} disabled={busy || suspended}
              onClick={() => run(async () => { setIssued(await issueCode({ userId })); setCopied(false) })}>
              {staff.codePendingUntil ? "Générer un nouveau code" : reset ? "Générer un code de réinitialisation" : "Générer un code d'activation"}
            </button>
            {suspended && <div className="cell-sub">Réactivez le compte avant de générer un code.</div>}
          </div>
        )}
      </div>

      <div className="drawer-section">
        <div className="card-title" style={{ marginBottom: 10 }}>Accès</div>
        {suspended ? (
          <button className="btn" disabled={locked || busy}
            onClick={() => run(() => setStatus({ userId, status: "active" }))}>
            Réactiver le compte
          </button>
        ) : confirmSuspend ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13 }}>
              {staff.name} sera déconnecté(e) immédiatement et ne pourra plus se connecter. Un code d'activation en attente sera annulé.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => setConfirmSuspend(false)} disabled={busy}>Annuler</button>
              <button className="btn" style={{ color: "var(--neg)" }} disabled={busy}
                onClick={() => run(async () => { await setStatus({ userId, status: "suspended" }); setConfirmSuspend(false); setIssued(null) })}>
                Confirmer la suspension
              </button>
            </div>
          </div>
        ) : (
          <button className="btn" style={{ color: "var(--neg)" }} disabled={locked || busy}
            onClick={() => setConfirmSuspend(true)}>
            Suspendre le compte
          </button>
        )}
      </div>

      {error && <div role="alert" style={{ color: "var(--neg)", fontSize: 12.5 }}>{error}</div>}
    </Drawer>
  )
}
