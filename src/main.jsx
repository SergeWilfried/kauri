import { Sentry } from './sentry'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexReactClient } from 'convex/react'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import '../styles.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)

createRoot(document.getElementById('root'), {
  // Errors no boundary catches; ErrorBoundary reports the ones it shows
  onUncaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ConvexAuthProvider>
  </StrictMode>
)
