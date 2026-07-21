import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS ?? path.join(root, 'artifacts', 'e2e')
const binary = process.env.QA_SCRIBE_E2E_BINARY ?? path.join(root, 'target', 'debug', process.platform === 'win32' ? 'qa-scribe-tauri.exe' : 'qa-scribe-tauri')
const spec = process.env.QA_SCRIBE_E2E_SPEC ?? 'critical-workflows.e2e.mjs'
const criticalScenarios = new Set(['session-lifecycle', 'manual-testware', 'clipboard', 'generation-cancellation', 'summary-recovery'])

if (spec === 'critical-workflows.e2e.mjs' && !criticalScenarios.has(process.env.QA_SCRIBE_E2E_SCENARIO)) {
  throw new Error('Run critical-workflows.e2e.mjs through scripts/run-e2e.mjs or set a valid QA_SCRIBE_E2E_SCENARIO')
}

export const config = {
  runner: 'local',
  specs: [path.join(root, 'e2e', 'specs', spec)],
  maxInstances: 1,
  capabilities: [{ browserName: 'tauri' }],
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 30_000,
  connectionRetryCount: 1,
  framework: 'mocha',
  reporters: [['spec', { addConsoleLogs: true }]],
  mochaOpts: {
    timeout: 60_000,
  },
  services: [
    [
      'tauri',
      {
        appBinaryPath: binary,
        driverProvider: 'embedded',
        captureBackendLogs: true,
        captureFrontendLogs: true,
        logDir: artifacts,
      },
    ],
  ],
  afterTest: async function (_test, _context, result) {
    if (result.passed) return
    const safeName = result.error?.message?.replace(/[^a-z0-9]+/gi, '-').slice(0, 80) || `failure-${Date.now()}`
    await browser.saveScreenshot(path.join(artifacts, `${safeName}.png`))
  },
}
