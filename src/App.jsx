import { useEffect, useState } from 'react'
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import { api } from '../convex/_generated/api'
import { Loading, Sidebar } from './components'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ClientsPage from './pages/ClientsPage'
import TransactionsPage from './pages/TransactionsPage'
import AgentsPage from './pages/AgentsPage'
import ObjectifsPage from './pages/ObjectifsPage'
import SettingsPage from './pages/SettingsPage'
import ProductsPage from './pages/ProductsPage'
import ReconciliationPage from './pages/ReconciliationPage'
import { setSentryUser } from './sentry'
import { canOpenPage, hasDashboardAccess, landingPage } from './access'

const PAGES = {
  dashboard:      DashboardPage,
  clients:        ClientsPage,
  tx:             TransactionsPage,
  agents:         AgentsPage,
  objectifs:      ObjectifsPage,
  produits:       ProductsPage,
  reconciliation: ReconciliationPage,
  settings:       SettingsPage,
}

export default function App() {
  return (
    <>
      <AuthLoading><Loading /></AuthLoading>
      <Unauthenticated><LoginPage /></Unauthenticated>
      <Authenticated><ActiveStaffGate /></Authenticated>
    </>
  )
}

// A session can outlive a suspension: show a sign-out screen instead of a
// shell whose every query would be refused.
function ActiveStaffGate() {
  const me = useQuery(api.users.me)
  const { signOut } = useAuthActions()
  const meId = me === undefined ? undefined : (me?.id ?? null)
  useEffect(() => {
    if (meId !== undefined) setSentryUser(meId)
  }, [meId])
  if (me === undefined) return <Loading />
  if (me?.active && hasDashboardAccess(me.can)) return <Shell can={me.can} />
  const message = me?.active
    // Field agents work from the mobile app; the server refuses them the dashboard data
    ? ["Accès réservé", "Le tableau de bord est réservé aux superviseurs, comptables et administrateurs. Utilisez l'application mobile."]
    : ["Compte inactif", "Ce compte est suspendu ou n'existe plus. Contactez l'Admin IT de votre agence."]
  return (
    <div style={{ padding: 40, maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
      <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8 }}>{message[0]}</div>
      <div style={{ color: "var(--ink-3)", fontSize: 13, marginBottom: 16 }}>{message[1]}</div>
      <button className="btn" onClick={() => signOut()}>Se déconnecter</button>
    </div>
  )
}

/** Shown instead of a page whose data this role can't read. */
function AccessDenied() {
  return (
    <div style={{ padding: 40, maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
      <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8 }}>Accès réservé</div>
      <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Votre rôle ne donne pas accès à cette page.</div>
    </div>
  )
}

const PAGE_TITLES = {
  dashboard: "Tableau de bord", clients: "Clients", tx: "Transactions", agents: "Agents",
  objectifs: "Objectifs", produits: "Produits", reconciliation: "Réconciliation", settings: "Paramètres",
}

function Shell({ can }) {
  const [active, setActive] = useState(() => landingPage(can))
  const Page = canOpenPage(active, can) ? (PAGES[active] ?? AccessDenied) : AccessDenied

  // Each page has its own title, read out when the page changes
  useEffect(() => {
    document.title = `${PAGE_TITLES[active] ?? "Mizo"} — Mizo`
  }, [active])

  return (
    <div className="app">
      <a className="skip-link" href="#main">Aller au contenu</a>
      <Sidebar active={active} setActive={setActive} />
      <main className="main" id="main" tabIndex={-1}>
        <Page />
      </main>
    </div>
  )
}
