import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import {
  Topbar, KPI, ClientsCard, TransactionsCard,
  VolumeChart, QuickActionsCard, KpiSkeleton, LoadingStatus, Skel, fmt,
} from '../components'
import Novu from '../components/Inbox'
import TopCollectorsCard from '../components/TopCollectorsCard'

/** Back-office dashboard: KPIs, volume chart, quick actions, recent clients and movements, top collectors. */
export default function DashboardPage() {
  const data = useQuery(api.admin.dashboard)

  return (
    <>
      <Topbar inbox={<Novu />} />
      {data === undefined ? <DashboardSkeleton /> : (
        <>
          <section className="kpi-row">
            {[
              { label: "Clients actifs", value: String(data.kpis.activeClients), unit: "", delta: `+${data.kpis.newClientsMonth}`, dir: "up", note: "nouveaux ce mois", icon: "users" },
              { label: "Épargne totale", value: fmt(data.kpis.totalSavings), unit: "FCFA", delta: "cumul", dir: "up", note: "collectes validées", icon: "wallet" },
              { label: "Transactions", value: String(data.kpis.txMonth), unit: "",
                delta: (data.kpis.txMonth - data.kpis.txPrevMonth >= 0 ? "+" : "−") + Math.abs(data.kpis.txMonth - data.kpis.txPrevMonth),
                dir: data.kpis.txMonth >= data.kpis.txPrevMonth ? "up" : "down", note: "ce mois vs. précédent", icon: "receipt" },
              { label: "Décaissements en attente", value: String(data.kpis.pendingDisbursements), unit: "",
                delta: fmt(data.kpis.pendingDisbursementsAmount) + " FCFA", dir: data.kpis.pendingDisbursements ? "down" : "up", note: "à approuver", icon: "coin" },
            ].map(k => <KPI key={k.label} k={k} />)}
          </section>

          <div className="row cols-2" style={{ marginBottom: 14 }}>
            <VolumeChart data={data.volume} />
            <QuickActionsCard />
          </div>

          <div className="row cols-2">
            <ClientsCard clients={data.clients} />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <TransactionsCard tx={data.recent} />
              {data.topCollectors.length > 0 && (
                <TopCollectorsCard collectors={data.topCollectors} total={data.collectedMonth} />
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}

/** Same layout as the loaded dashboard: KPI tiles, then two rows of two cards. */
function DashboardSkeleton() {
  const card = (h) => (
    <div className="card" style={{ padding: 18, minHeight: h }} aria-hidden="true">
      <Skel w="40%" h={13} />
      <Skel w="25%" h={10} style={{ margin: "8px 0 20px" }} />
      <Skel h={h - 90} r={8} />
    </div>
  )
  return (
    <>
      <LoadingStatus label="Chargement du tableau de bord…" />
      <KpiSkeleton />
      <div className="row cols-2" style={{ marginBottom: 14 }}>{card(280)}{card(280)}</div>
      <div className="row cols-2">{card(320)}{card(320)}</div>
    </>
  )
}
