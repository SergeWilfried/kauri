import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Source maps go to Sentry only when the build has SENTRY_AUTH_TOKEN; they
// are deleted from dist afterwards so the deployed site doesn't serve them.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN)

export default defineConfig({
  plugins: [
    react(),
    uploadSourceMaps && sentryVitePlugin({
      url: 'https://de.sentry.io/',
      org: 'progiciel-labs',
      project: 'mizo-admin',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }),
  ],
  build: { sourcemap: uploadSourceMaps ? 'hidden' : false },
})
