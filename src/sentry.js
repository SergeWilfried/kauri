import * as Sentry from '@sentry/react'

// Error reporting to Sentry (progiciel-labs/mizo-admin). The DSN only lets
// the page send events; VITE_SENTRY_DSN overrides it. Off on `vite dev`.
const DSN = import.meta.env.VITE_SENTRY_DSN
  || 'https://dc2f3b9c6ea6aa8098b10c35d8418b43@o4512016838361088.ingest.de.sentry.io/4512267506942032'

Sentry.init({
  dsn: DSN,
  enabled: import.meta.env.PROD,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
  // Staff names, emails and phone numbers stay out of Sentry: only the user id is sent
  sendDefaultPii: false,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.2,
})

/** Attach the signed-in staff id to later events; null when signed out. */
export function setSentryUser(id) {
  Sentry.setUser(id ? { id } : null)
}

export { Sentry }
