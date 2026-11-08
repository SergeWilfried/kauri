// Which dashboard pages a staff member may open, from the `can` flags of
// users.me. Mirrors the server checks in convex/admin.ts, which refuse the
// data anyway: this only keeps the UI from offering pages that would fail.

const BACK_OFFICE = new Set(["dashboard", "clients", "tx", "objectifs", "produits", "reconciliation"])

/** True if the page's data is readable: back office needs `audit`, Agents also opens to IT. */
export function canOpenPage(page, can = {}) {
  if (page === "settings") return true
  if (page === "agents") return !!(can.audit || can.manageStaff || can.bind)
  if (BACK_OFFICE.has(page)) return !!can.audit
  return false
}

/** True for staff with no dashboard page at all (field agents use the mobile app). */
export function hasDashboardAccess(can = {}) {
  return !!(can.audit || can.manageStaff || can.bind)
}

/** The page to open after sign-in. */
export function landingPage(can = {}) {
  return can.audit ? "dashboard" : "agents"
}
