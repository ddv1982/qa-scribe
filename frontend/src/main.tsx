import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

async function bootstrap() {
  // Vite removes this branch and its dynamic chunk from normal production
  // builds. The matching Rust plugins and permissions are feature/config
  // gated independently, so no single missed switch can expose E2E access.
  if (import.meta.env.VITE_QA_SCRIBE_E2E === '1') {
    await import('@wdio/tauri-plugin')
    document.title = 'QA Scribe E2E (dev)'
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
