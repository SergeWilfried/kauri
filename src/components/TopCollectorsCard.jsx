import { fmt, initials } from '../components'

/**
 * This month's four biggest field collectors (TPE deposits) and their share
 * of the month's field collection. `collectors` comes from admin:dashboard.
 */
export default function TopCollectorsCard({ collectors, total }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Top collecteurs · ce mois</div>
        <span className="card-sub" style={{ marginLeft: "auto" }}>Sur le terrain</span>
      </div>
      <div style={{ padding: "4px 14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {collectors.map((a, i) => {
          const pct = total ? Math.round((a.collected / total) * 100) : 0
          return (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 18, fontWeight: 600, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{i + 1}</div>
              <div className="avatar sm">{initials(a.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 550, fontSize: 13 }}>{a.name}</div>
                <div className="cell-sub" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>{a.serials.join(", ") || "—"} · {a.branch}</div>
                <div className="goal-bar" style={{ marginTop: 4 }}>
                  <div className="goal-fill" style={{ width: Math.min(100, pct) + "%" }}/>
                </div>
              </div>
              <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{fmt(a.collected)}</div>
                <div className="cell-sub">{pct}% du total · {a.txCount} tx</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
