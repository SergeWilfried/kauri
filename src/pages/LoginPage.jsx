import { useState } from 'react'
import { useAction } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import { api } from '../../convex/_generated/api'
import { MizoMark, MizoWordmark } from '../components/Brand'

// Per flow: heading, intro, code label, submit label, and the error shown for
// any refusal (the same whatever the cause, so the form never reveals which
// emails are staff).
const FLOWS = {
  signIn: {
    title: "Connexion",
    intro: "Accès réservé au personnel de l'agence.",
    submit: "Se connecter",
    error: "Email ou mot de passe incorrect.",
  },
  signUp: {
    title: "Première connexion",
    intro: "Saisissez le code d'activation reçu de l'Admin IT, puis choisissez votre mot de passe.",
    codeLabel: "Code d'activation",
    submit: "Activer mon compte",
    error: "Activation impossible. Vérifiez l'email et le code d'activation, ou demandez un nouveau code à l'Admin IT.",
  },
  reset: {
    title: "Mot de passe oublié",
    intro: "Demandez un code de réinitialisation à l'Admin IT, puis choisissez un nouveau mot de passe. Vous serez déconnecté de vos autres appareils.",
    codeLabel: "Code de réinitialisation",
    submit: "Changer le mot de passe",
    error: "Réinitialisation impossible. Vérifiez l'email et le code, ou demandez un nouveau code à l'Admin IT.",
  },
}

/**
 * Staff-only sign-in. "Première connexion" sets the password for a staff
 * member an administrator already created, and "Mot de passe oublié" replaces
 * it; both use a one-time code that administrator issued. There is no open
 * sign-up and no self-service reset by email.
 */
export default function LoginPage() {
  const { signIn } = useAuthActions()
  const resetPassword = useAction(api.passwordReset.resetPassword)
  const [flow, setFlow]       = useState("signIn")
  const [email, setEmail]     = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [code, setCode]       = useState("")
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState(null)

  const f = FLOWS[flow]
  const withCode = flow !== "signIn"

  const onSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (withCode) {
      if (password.length < 8) return setError("Le mot de passe doit contenir au moins 8 caractères.")
      if (password !== confirm) return setError("Les mots de passe ne correspondent pas.")
    }
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedCode  = code.trim().toUpperCase()
    setBusy(true)
    try {
      if (flow === "reset") {
        await resetPassword({ email: normalizedEmail, code: normalizedCode, newPassword: password })
        try {
          await signIn("password", { email: normalizedEmail, password, flow: "signIn" })
        } catch {
          // The password did change; let the person sign in by hand
          switchFlow("signIn")
          setError("Mot de passe modifié. Connectez-vous avec le nouveau mot de passe.")
        }
      } else {
        await signIn("password", {
          email: normalizedEmail, password, flow,
          ...(flow === "signUp" && { code: normalizedCode }),
        })
      }
    } catch {
      setError(f.error)
    } finally {
      setBusy(false)
    }
  }

  const switchFlow = (next) => {
    setFlow(next)
    setError(null); setPassword(""); setConfirm(""); setCode("")
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "var(--bg)" }}>
      <form onSubmit={onSubmit} className="card" style={{ width: "100%", maxWidth: 380, padding: 28 }}>
        <div className="brand" style={{ padding: 0, marginBottom: 22 }}>
          <MizoMark />
          <div>
            <div className="brand-name"><MizoWordmark /></div>
            <div className="brand-sub">Gestion d'épargne</div>
          </div>
        </div>

        <h1 className="h1" style={{ fontSize: 20, marginBottom: 4 }}>{f.title}</h1>
        <div className="h1-sub" style={{ marginBottom: 20 }}>{f.intro}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label className="field">
            <span className="field-label">Email professionnel</span>
            <input className="input" type="email" autoComplete="username" required
              value={email} onChange={e => setEmail(e.target.value)} placeholder="prenom.nom@exemple.bf" />
          </label>
          {withCode && (
            <label className="field">
              <span className="field-label">{f.codeLabel}</span>
              <input className="input" required autoComplete="one-time-code" spellCheck={false}
                value={code} onChange={e => setCode(e.target.value)} placeholder="K7QM4TPZ"
                style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" }} />
            </label>
          )}
          <label className="field">
            <span className="field-label">{withCode ? "Nouveau mot de passe" : "Mot de passe"}</span>
            <input className="input" type="password" required
              autoComplete={withCode ? "new-password" : "current-password"}
              value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          {withCode && (
            <label className="field">
              <span className="field-label">Confirmer le mot de passe</span>
              <input className="input" type="password" autoComplete="new-password" required
                value={confirm} onChange={e => setConfirm(e.target.value)} />
            </label>
          )}

          {error && <div role="alert" style={{ color: "var(--neg)", fontSize: 12.5 }}>{error}</div>}

          <button className="btn brand" type="submit" disabled={busy}
            style={{ justifyContent: "center", padding: "9px 12px" }}>
            {busy ? "Patientez…" : f.submit}
          </button>
        </div>

        <div style={{ marginTop: 18, fontSize: 12.5, color: "var(--ink-3)", textAlign: "center", display: "flex", flexDirection: "column", gap: 4 }}>
          {flow === "signIn" ? (
            <>
              <span>Pas encore de mot de passe ?{" "}
                <button type="button" className="btn ghost sm" onClick={() => switchFlow("signUp")} style={{ padding: "2px 4px" }}>Première connexion</button>
              </span>
              <span>
                <button type="button" className="btn ghost sm" onClick={() => switchFlow("reset")} style={{ padding: "2px 4px" }}>Mot de passe oublié ?</button>
              </span>
            </>
          ) : (
            <span>{flow === "signUp" ? "Déjà un mot de passe ? " : "Vous vous en souvenez ? "}
              <button type="button" className="btn ghost sm" onClick={() => switchFlow("signIn")} style={{ padding: "2px 4px" }}>Se connecter</button>
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
