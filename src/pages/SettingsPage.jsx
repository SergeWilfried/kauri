import { useState } from 'react'
import { I } from '../icons'
import { MizoMark } from '../components/Brand'
import { PageHeader } from '../components'
import Novu from '../components/Inbox'
import PermissionsMatrix from '../components/PermissionsMatrix'


/** Settings section card with title and optional subtitle. */
function SetCard({ title, sub, children }) {
  return (
    <div className="card">
      <div className="card-head" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
        <div className="card-title">{title}</div>
        {sub && <div className="card-sub">{sub}</div>}
      </div>
      <div className="set-body">{children}</div>
    </div>
  )
}

/** Labelled form field. */
function Field({ label, sub, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}{sub && <span className="cell-sub" style={{ fontWeight: 400, marginLeft: 6 }}>· {sub}</span>}</span>
      {children}
    </label>
  )
}

/** Labelled on/off switch row. */
function Toggle({ label, sub, value, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={value} className="toggle-row" onClick={() => onChange(!value)}>
      <div>
        <div style={{ fontWeight: 550, fontSize: 13 }}>{label}</div>
        {sub && <div className="cell-sub">{sub}</div>}
      </div>
      <span className={"switch " + (value ? "on" : "")}><span className="knob"/></span>
    </button>
  )
}

/** Settings sections (local state only, not persisted yet). */
export default function SettingsPage() {
  const [section, setSection] = useState("agence")
  const [orgName, setOrgName] = useState("Kauri Microfinance")
  const [currency, setCurrency] = useState("FCFA (XOF)")
  const [twoFA, setTwoFA] = useState(true)
  const [autoLock, setAutoLock] = useState(5)
  const [notif, setNotif] = useState({ deposit: true, withdraw: true, lowBattery: true, syncFail: true, weekly: false })
  const [bgSync, setBgSync] = useState(true)
  const [blockOfflineWithdrawals, setBlockOfflineWithdrawals] = useState(true)
  const [autoExport, setAutoExport] = useState(true)
  const [offlineDays, setOfflineDays] = useState(3)
  const [isEditing, setIsEditing] = useState(false)
  const sections = [
    { k: "agence",        label: "Agence",       icon: <I.Pin/> },
    { k: "tpe",           label: "Terminaux TPE", icon: <I.Wifi/> },
    { k: "securite",      label: "Sécurité",      icon: <I.Shield/> },
    { k: "roles",         label: "Rôles & permissions", icon: <I.Users/> },
    { k: "notifications", label: "Notifications", icon: <I.Bell/> },
    { k: "facturation",   label: "Facturation",   icon: <I.Wallet/> },
    { k: "integrations",  label: "Intégrations",  icon: <I.Cloud/> },
  ]

  return (
    <div className="settings-page">
      <PageHeader
        crumbs={["Paramètres"]}
        title="Paramètres"
      >
        {isEditing ? (
          <>
            <button className="btn">Annuler</button>
            <button className="btn brand"><I.Check size={14} stroke="white"/>Enregistrer</button>
          </>
        ) : (
          <>
          <Novu />
          </>
        )}
      </PageHeader>

      <div className="settings-grid">
        <aside className="settings-nav">
          {sections.map(s => (
            <button key={s.k} aria-pressed={section === s.k} className={"settings-nav-item " + (section === s.k ? "on" : "")} onClick={() => setSection(s.k)}>
              {s.icon}<span>{s.label}</span>
            </button>
          ))}
        </aside>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {section === "agence" && (
            <>
              <SetCard title="Identité de l'institution" sub="Visible dans les reçus, exports et l'en-tête de l'app.">
                <Field label="Nom de l'institution"><input className="input" value={orgName} onChange={e => setOrgName(e.target.value)}/></Field>
                <Field label="Numéro d'agrément"><input className="input" defaultValue="MFI-BF-2024-0142"/></Field>
                <Field label="Devise">
                  <select className="input" value={currency} onChange={e => setCurrency(e.target.value)}>
                    <option>FCFA (XOF)</option><option>EUR</option><option>USD</option>
                  </select>
                </Field>
                <Field label="Fuseau horaire">
                  <select className="input" defaultValue="GMT+0 · Ouagadougou">
                    <option>GMT+0 · Ouagadougou</option><option>GMT+0 · Bamako</option><option>GMT+1 · Lagos</option>
                  </select>
                </Field>
                <Field label="Logo (PNG/SVG)">
                  <div className="upload">
                    <MizoMark size={40} />
                    <div>
                      <div style={{ fontWeight: 550, fontSize: 13 }}>mizo-logo.svg</div>
                      <div className="cell-sub">3,2 Ko · remplacer</div>
                    </div>
                    <button className="btn sm" style={{ marginLeft: "auto" }}>Choisir…</button>
                  </div>
                </Field>
              </SetCard>

              <SetCard title="Agences" sub="3 agences actives · ajoutez ou archivez selon votre couverture.">
                <table className="data-table" style={{ minWidth: "auto" }}>
                  <thead><tr><th>Agence</th><th>Code</th><th>Agents</th><th>Statut</th><th></th></tr></thead>
                  <tbody>
                    {[
                      { n: "Bobo-Dioulasso", c: "BBO", a: 3 },
                      { n: "Banfora",        c: "BNF", a: 2 },
                      { n: "Hounde",         c: "HND", a: 1 },
                    ].map(b => (
                      <tr key={b.c}>
                        <td style={{ fontWeight: 550 }}>{b.n}</td>
                        <td className="cell-sub" style={{ fontFamily: "var(--font-mono)" }}>{b.c}</td>
                        <td>{b.a}</td>
                        <td><span className="tag actif">Actif</span></td>
                        <td><button className="btn ghost sm" style={{ padding: 4 }} aria-label={`Actions pour ${b.n}`}><I.More size={14}/></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: 12 }}><button className="btn sm"><I.Plus size={12}/>Ajouter une agence</button></div>
              </SetCard>
            </>
          )}

          {section === "tpe" && (
            <>
              <SetCard title="Mode hors-ligne" sub="Comportement des TPE quand le réseau n'est pas disponible.">
                <Toggle label="Synchronisation automatique en arrière-plan" sub="Les TPE retentent toutes les 5 minutes." value={bgSync} onChange={setBgSync}/>
                <Field label={`Durée maximale hors-ligne · ${offlineDays} jours`} sub="Au-delà, le TPE refuse de nouveaux mouvements jusqu'à sync.">
                  <input type="range" min={1} max={14} value={offlineDays} onChange={e => setOfflineDays(+e.target.value)} style={{ width: "100%" }}/>
                </Field>
                <Toggle label="Bloquer les retraits hors-ligne" sub="Recommandé. Les dépôts restent autorisés." value={blockOfflineWithdrawals} onChange={setBlockOfflineWithdrawals}/>
              </SetCard>

              <SetCard title="Plafonds par transaction" sub="Limites appliquées au TPE; les superviseurs peuvent valider au-delà.">
                <Field label="Dépôt maximum"><div className="input-row"><input className="input" defaultValue="500 000"/><span className="cell-sub">FCFA</span></div></Field>
                <Field label="Retrait maximum"><div className="input-row"><input className="input" defaultValue="200 000"/><span className="cell-sub">FCFA</span></div></Field>
                <Field label="Cotisation tontine"><div className="input-row"><input className="input" defaultValue="50 000"/><span className="cell-sub">FCFA</span></div></Field>
              </SetCard>

              <SetCard title="Mises à jour TPE" sub="Version 4.2.1 disponible. 5 / 6 terminaux à jour.">
                <div className="upload">
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--info-soft)", display: "grid", placeItems: "center", color: "var(--info)" }}><I.Cloud size={18}/></div>
                  <div>
                    <div style={{ fontWeight: 550, fontSize: 13 }}>Mizo TPE 4.2.1 · 4 mai 2026</div>
                    <div className="cell-sub">Corrige le délai de sync sur réseau 2G.</div>
                  </div>
                  <button className="btn brand sm" style={{ marginLeft: "auto" }}>Déployer</button>
                </div>
              </SetCard>
            </>
          )}

          {section === "securite" && (
            <>
              <SetCard title="Authentification" sub="Connexion des agents et accès au tableau d'administration.">
                <Toggle label="Vérification en deux étapes (SMS)" sub="Code à 6 chiffres envoyé au numéro de l'agent." value={twoFA} onChange={setTwoFA}/>
                <Field label={`Verrouillage automatique · ${autoLock} min`} sub="Le TPE se verrouille après inactivité.">
                  <input type="range" min={1} max={30} value={autoLock} onChange={e => setAutoLock(+e.target.value)} style={{ width: "100%" }}/>
                </Field>
                <Field label="Politique de PIN">
                  <select className="input" defaultValue="6 chiffres · rotation 90 j">
                    <option>4 chiffres · rotation 180 j</option>
                    <option>6 chiffres · rotation 90 j</option>
                    <option>6 chiffres + biométrie</option>
                  </select>
                </Field>
              </SetCard>
              <SetCard title="Audit & journalisation" sub="Conservation des journaux d'événements.">
                <Field label="Durée de conservation">
                  <select className="input" defaultValue="36 mois">
                    <option>12 mois</option><option>24 mois</option><option>36 mois</option><option>60 mois</option>
                  </select>
                </Field>
                <Toggle label="Exporter automatiquement vers le coffre" sub="Sauvegarde chiffrée chaque dimanche à 02:00." value={autoExport} onChange={setAutoExport}/>
              </SetCard>
            </>
          )}

          {section === "roles" && (
            <SetCard title="Permissions · matrice" sub="Ce que chaque rôle peut faire. Les rôles s'attribuent depuis Agents & TPE.">
              <PermissionsMatrix />
            </SetCard>
          )}

          {section === "notifications" && (
            <SetCard title="Alertes" sub="Choisissez ce que vous recevez par e-mail et sur le tableau de bord.">
              <Toggle label="Nouveau dépôt"              sub="Au-dessus de 100 000 FCFA"   value={notif.deposit}    onChange={v => setNotif({...notif, deposit: v})}/>
              <Toggle label="Nouveau retrait"            sub="Toujours notifier"            value={notif.withdraw}   onChange={v => setNotif({...notif, withdraw: v})}/>
              <Toggle label="Batterie TPE faible"        sub="Sous 20%"                     value={notif.lowBattery} onChange={v => setNotif({...notif, lowBattery: v})}/>
              <Toggle label="Échec de synchronisation"   sub="Si > 1 h hors-ligne"          value={notif.syncFail}   onChange={v => setNotif({...notif, syncFail: v})}/>
              <Toggle label="Rapport hebdomadaire"       sub="Tous les lundis à 07:00"      value={notif.weekly}     onChange={v => setNotif({...notif, weekly: v})}/>
            </SetCard>
          )}

          {section === "facturation" && (
            <>
              <SetCard title="Forfait" sub="Forfait Croissance · facturé annuellement.">
                <div className="plan-row">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>Croissance</div>
                    <div className="cell-sub">Jusqu'à 5 TPE · 200 clients par agent · sync illimitée</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>240 000<span className="cell-sub" style={{ marginLeft: 4 }}>FCFA / an</span></div>
                    <div className="cell-sub">Renouvellement le 14 août 2026</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, padding: "12px 16px" }}>
                  <button className="btn sm">Changer de forfait</button>
                  <button className="btn ghost sm">Télécharger les factures</button>
                </div>
              </SetCard>
              <SetCard title="Méthode de paiement">
                <div className="upload">
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--brand-softer)", display: "grid", placeItems: "center", color: "var(--brand-ink)" }}><I.Wallet size={18}/></div>
                  <div>
                    <div style={{ fontWeight: 550, fontSize: 13 }}>Mobile Money · Orange BF</div>
                    <div className="cell-sub">+226 70 •• •• 22</div>
                  </div>
                  <button className="btn sm" style={{ marginLeft: "auto" }}>Modifier</button>
                </div>
              </SetCard>
            </>
          )}

          {section === "integrations" && (
            <SetCard title="Intégrations" sub="Connectez Mizo à vos outils existants.">
              {[
                { n: "Orange Money",         s: "Connecté",     dot: "actif",   d: "Encaissements MoMo en temps réel" },
                { n: "Moov Africa",          s: "Connecté",     dot: "actif",   d: "Encaissements MoMo en temps réel" },
                { n: "SMS Gateway",          s: "Connecté",     dot: "actif",   d: "Confirmations client par SMS" },
                { n: "Comptabilité Sage",    s: "Non connecté", dot: "archive", d: "Export automatique du grand livre" },
                { n: "Webhook personnalisé", s: "Non connecté", dot: "archive", d: "POST sur événements clés" },
              ].map(it => (
                <div key={it.n} className="upload">
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--surface-inset)", display: "grid", placeItems: "center" }}>
                    <I.Cloud size={16}/>
                  </div>
                  <div>
                    <div style={{ fontWeight: 550, fontSize: 13 }}>{it.n}</div>
                    <div className="cell-sub">{it.d}</div>
                  </div>
                  <span className={"tag " + it.dot} style={{ marginLeft: "auto" }}>{it.s}</span>
                  <button className="btn sm">{it.dot === "actif" ? "Configurer" : "Connecter"}</button>
                </div>
              ))}
            </SetCard>
          )}
        </div>
      </div>
    </div>
  )
}
