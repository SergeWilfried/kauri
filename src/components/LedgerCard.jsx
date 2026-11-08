import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { fmt, fmtDateTime, relTime } from '../components'

const SHOWN = 8
const NUM = { textAlign: "right", fontVariantNumeric: "tabular-nums" }

/** Customer id from a ledger address: customers:{id}:savings or customers:{id}:vault:{product}. */
const accountLabel = (address) => {
  const [, id, kind] = address.split(":")
  return { id, kind: kind === "vault" ? "Coffre produit" : "Épargne" }
}

/**
 * Health of the Formance audit ledger (convex/ledger.ts) for auditors: last
 * nightly balance check, accounts that disagree, and movements not posted
 * yet or refused by the ledger.
 */
export default function LedgerCard() {
  const me = useQuery(api.users.me)
  const status = useQuery(api.ledger.status, me?.can?.audit ? {} : "skip")
  if (!status) return null
  if (!status.enabled) {
    return (
      <div className="card" style={{ padding: "12px 18px", marginBottom: 14, fontSize: 12.5, color: "var(--ink-3)" }}>
        Grand livre d'audit (Formance) non configuré : les mouvements ne sont enregistrés que dans la base de l'application.
      </div>
    )
  }

  const check = status.lastCheck
  const mismatches = check?.mismatches ?? []
  const tag = !check
    ? <span className="tag attente">Pas encore contrôlé</span>
    : check.error
      ? <span className="tag alerte">Contrôle impossible</span>
      : mismatches.length > 0
        ? <span className="tag alerte">{mismatches.length}{mismatches.length >= 50 ? "+" : ""} écart{mismatches.length > 1 ? "s" : ""}</span>
        : <span className="tag actif">Concordant</span>
  const backlog = `${status.backlog}${status.backlogCapped ? "+" : ""}`

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div className="card-title">Grand livre d'audit</div>
        <span style={{ marginLeft: 10 }}>{tag}</span>
        <span className="card-sub" style={{ marginLeft: "auto" }}>Formance · registre « {status.ledger} »</span>
      </div>
      <div style={{ padding: "4px 18px 14px", fontSize: 13, lineHeight: 1.6 }}>
        {check ? (
          <div>
            Dernier contrôle {relTime(check.at)} : {check.accounts} compte{check.accounts > 1 ? "s" : ""} client
            {check.unposted > 0 && <> · {check.unposted} mouvement{check.unposted > 1 ? "s" : ""} pas encore dans le grand livre</>}
            {check.error && <div role="alert" style={{ color: "var(--neg)" }}>{check.error}</div>}
          </div>
        ) : (
          <div className="cell-sub">Le premier contrôle des soldes a lieu cette nuit.</div>
        )}
        <div className="cell-sub">
          {status.backlog === 0
            ? "Tous les mouvements sont dans le grand livre."
            : `${backlog} mouvement${status.backlog > 1 ? "s" : ""} en file d'envoi (repris toutes les 5 minutes).`}
        </div>
      </div>

      {mismatches.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Client</th><th>Compte</th><th style={NUM}>Application</th><th style={NUM}>Grand livre</th><th style={NUM}>Écart</th></tr></thead>
            <tbody>
              {mismatches.slice(0, SHOWN).map(m => {
                const a = accountLabel(m.account)
                return (
                  <tr key={m.account}>
                    <td>
                      {m.client ?? "Client inconnu"}
                      <div className="cell-sub" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{a.id}</div>
                    </td>
                    <td>{a.kind}</td>
                    <td style={NUM}>{fmt(m.convex)}</td>
                    <td style={NUM}>{fmt(m.ledger)}</td>
                    <td style={{ ...NUM, color: "var(--neg)", fontWeight: 600 }}>{fmt(m.convex - m.ledger)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {mismatches.length > SHOWN && <div className="cell-sub" style={{ padding: "8px 18px" }}>… et {mismatches.length - SHOWN} autres</div>}
        </div>
      )}

      {status.failures.length > 0 && (
        <div style={{ padding: "10px 18px 14px", borderTop: "1px solid var(--border)" }}>
          <div className="card-title" style={{ fontSize: 13, marginBottom: 6 }}>Refusés ou en erreur</div>
          {status.failures.map(f => (
            <div key={f.id} style={{ fontSize: 12.5, display: "flex", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{f.id}</span>
              <span className="cell-sub">{fmtDateTime(f.timestamp)}</span>
              <span style={{ color: "var(--neg)" }}>{f.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
