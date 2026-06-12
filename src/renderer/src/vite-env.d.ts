/// <reference types="vite/client" />

import type { QaScribeApi } from '../../shared/contracts'

declare global {
  interface Window {
    qaScribe: QaScribeApi
  }
}
