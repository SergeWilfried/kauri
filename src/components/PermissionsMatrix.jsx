import { I } from '../icons'

// Mirrors the role definitions in convex/authz.ts
const ROWS = [
  ["Encaisser (TPE)",            1, 1, 0, 0],
  ["Inscrire un client",         1, 1, 0, 0],
  ["Demander un décaissement",   1, 1, 0, 0],
  ["Annuler une transaction",    0, 1, 0, 0],
  ["Approuver un décaissement",  0, 1, 0, 0],
  ["Vérifier l'identité client", 0, 1, 1, 0],
  ["Clôturer la caisse",         0, 0, 1, 0],
  ["Lier les TPE",               0, 0, 0, 1],
  ["Gérer le personnel",         0, 0, 0, 1],
]

/** What each role may do, as a read-only grid. */
export default function PermissionsMatrix() {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="perm-table">
        <thead>
          <tr><th></th><th>Agent</th><th>Superv.</th><th>Compta.</th><th>Admin IT</th></tr>
        </thead>
        <tbody>
          {ROWS.map(([label, ...vals]) => (
            <tr key={label}>
              <td>{label}</td>
              {vals.map((v, i) => (
                <td key={i} style={{ textAlign: "center" }}>
                  {v ? <span className="perm-yes"><I.Check size={11} stroke="white"/></span> : <span className="perm-no">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
