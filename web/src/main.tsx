import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/quattrocento/latin-400.css'
import '@fontsource/quattrocento/latin-700.css'
import './index.css'
import App from './App.tsx'
import { analyticsBeacon, startAnalytics } from './analytics'
import { hostedSite } from './api/client'

startAnalytics(analyticsBeacon(import.meta.env.VITE_CF_ANALYTICS_TOKEN, hostedSite))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
