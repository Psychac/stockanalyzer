import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './ui/App'
import { useApp } from './store'
import { forgetLegacySecrets, refreshAuth } from './market/auth'

forgetLegacySecrets()
void refreshAuth()

// Dev server only: lets browser tests inject state. Stripped from production builds.
if (import.meta.env.DEV) (window as unknown as { __app: typeof useApp }).__app = useApp

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
