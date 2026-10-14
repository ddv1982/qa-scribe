import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.QA_SCRIBE_LIVE_ARMED !== '1') throw new Error('Use the opt-in live authorization helper with --armed.')
// Set before dynamic import: the base config validates its default critical spec.
process.env.QA_SCRIBE_E2E_SPEC = 'chat-authorization-live.e2e.mjs'
const { config: base } = await import('./wdio.conf.mjs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const config = {
  ...base,
  specs: [path.join(root, 'e2e', 'specs', 'chat-authorization-live.e2e.mjs')],
  mochaOpts: { timeout: 300_000 },
  logLevel: 'silent',
  reporters: [],
  services: [['tauri', {
    appBinaryPath: process.env.QA_SCRIBE_E2E_BINARY,
    driverProvider: 'embedded',
    captureBackendLogs: false,
    captureFrontendLogs: false,
    logDir: process.env.QA_SCRIBE_E2E_ARTIFACTS,
  }]],
  // Raw errors, screenshots and model text can contain account data. Only the
  // allowlisted spec evidence is retained; helper discards runner output.
  afterTest: async function () {},
}
