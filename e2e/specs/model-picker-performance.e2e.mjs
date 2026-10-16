import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, platform, release } from 'node:os'
import { join } from 'node:path'
import { journal, refresh, settings } from './model-evidence-ui.mjs'

const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
const revision = process.env.QA_SCRIBE_E2E_BENCHMARK_REVISION
assert.ok(artifacts && revision, 'Picker measurement requires an artifact directory and exact declared source revision')
const trigger = '#ai-execution-settings [aria-label="Open model choices"]'
const receipt = { revision, buildMode: process.env.QA_SCRIBE_E2E_BENCHMARK_BUILD_MODE ?? 'e2e-debug-native',
  scope: 'Actual click capture to first animation frame with matching visible DOM state. This excludes WDIO transport and does not establish physical paint time.',
  machine: { platform: platform(), release: release(), logicalCpus: cpus().length, loadAverage: loadavg() },
  binarySha256: createHash('sha256').update(readFileSync(process.env.QA_SCRIBE_E2E_BINARY)).digest('hex'),
  completed: false, failures: 0 }

function persist() { writeFileSync(join(artifacts, 'picker-measurement.json'), `${JSON.stringify(receipt, null, 2)}\n`) }

describe('Shared Settings picker native DOM observation', () => {
  it('records ten actual warm open and close pairs plus explicit discovery transactions', async () => {
    mkdirSync(artifacts, { recursive: true })
    persist()
    try {
      await $('button=New Session').waitForClickable()
      await settings()
      await refresh()
      const beforeRefresh = journal().length
      await refresh()
      const observations = journal().slice(beforeRefresh)
      receipt.discoveryTransactions = Object.fromEntries(['claude', 'codex', 'copilot'].map((provider) => [provider,
        observations.filter((entry) => entry.provider === provider && entry.event === 'spawn'
          && (provider === 'claude' ? entry.argv.includes('--setting-sources')
            : provider === 'codex' ? entry.argv[0] === 'app-server' : entry.argv.includes('--server'))).length]))
      assert.deepEqual(receipt.discoveryTransactions, { claude: 1, codex: 1, copilot: 1 }, 'One explicit refresh must not duplicate discovery transactions')
      receipt.refreshObservations = observations
      const beforeInteractions = journal().length
      await browser.execute((selector) => {
        const state = { samples: [], errors: [], pending: null }
        window.__qaScribePickerObservation = state
        const check = () => {
          const pending = state.pending
          if (!pending) return
          const input = document.querySelector('#ai-execution-settings [role="combobox"]')
          const popup = document.querySelector('#ai-execution-settings .model-combobox-popover')
          const bounds = popup?.getBoundingClientRect()
          const visible = Boolean(bounds && bounds.width > 0 && bounds.height > 0)
          if ((input?.getAttribute('aria-expanded') === 'true') === pending.open && visible === pending.open) {
            const at = performance.now()
            state.samples.push({ action: pending.open ? 'open' : 'close', eventAtMs: pending.at,
              visibleFrameAtMs: at, elapsedMs: at - pending.at,
              optionCount: popup?.querySelectorAll('[role="option"]').length ?? 0 })
            state.pending = null
          } else if (performance.now() - pending.at > 2000) {
            state.errors.push('Picker did not reach its expected visible DOM state within 2 seconds')
            state.pending = null
          } else requestAnimationFrame(check)
        }
        document.addEventListener('click', (event) => {
          if (!event.target.closest(selector)) return
          if (state.pending) state.errors.push('A new click overlapped an unobserved picker state')
          state.pending = { at: performance.now(), open: document.querySelector('#ai-execution-settings [role="combobox"]').getAttribute('aria-expanded') !== 'true' }
          requestAnimationFrame(check)
        }, true)
      }, trigger)
      for (let pair = 0; pair < 10; pair += 1) {
        for (const open of [true, false]) {
          await $(trigger).click()
          await browser.waitUntil(async () => browser.execute((count) =>
            window.__qaScribePickerObservation.samples.length === count || window.__qaScribePickerObservation.errors.length > 0,
          pair * 2 + (open ? 1 : 2)), { timeout: 5_000 })
        }
      }
      receipt.observation = await browser.execute(() => window.__qaScribePickerObservation)
      assert.deepEqual(receipt.observation.errors, [])
      assert.equal(receipt.observation.samples.length, 20)
      assert.equal(receipt.observation.samples.filter((sample) => sample.action === 'open' && sample.optionCount > 0).length, 10)
      receipt.warmInteractionProviderSpawns = journal().slice(beforeInteractions).filter((entry) => entry.event === 'spawn').length
      assert.equal(receipt.warmInteractionProviderSpawns, 0, 'Warm picker interaction must not start provider discovery')
      receipt.machine.loadAverageAfter = loadavg()
      receipt.completed = true
      await browser.saveScreenshot(join(artifacts, 'picker-after-ten-pairs.png'))
    } catch (error) { receipt.failures += 1; receipt.error = error.message; throw error }
    finally { persist() }
  }).timeout(60_000)
})
