import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { readIsolationEvidence } from './ask-ai-isolation-evidence.mjs'
import { createWdioInvocationPlan } from './run-e2e.mjs'

test('the six-journey native run stays isolated and routing keeps its own restart pair', () => {
  for (const platform of ['linux', 'darwin']) {
    const plan = createWdioInvocationPlan({}, '/tmp/root', '/tmp/artifacts', platform)
    const runs = plan.filter(row => row.id.startsWith('ask-ai-isolation-'))
    assert.deepEqual(runs, createWdioInvocationPlan({ QA_SCRIBE_E2E_SPEC: 'ask-ai-conversation-isolation.e2e.mjs' }, '/tmp/root', '/tmp/artifacts', platform))
    assert.deepEqual(runs.map(row => row.id), ['ask-ai-isolation-initial'])
    for (const key of ['QA_SCRIBE_E2E_APP_DATA_DIR', 'QA_SCRIBE_E2E_FIXTURE_DIR']) {
      assert.ok(plan.filter(row => !runs.includes(row)).every(row => row.environment[key] !== runs[0].environment[key]))
    }
    const routing = createWdioInvocationPlan({ QA_SCRIBE_E2E_SPEC: 'ask-ai-conversation-routing.e2e.mjs' }, '/tmp/root', '/tmp/artifacts', platform)
    assert.deepEqual(routing.map(row => row.id), ['routing-initial', 'routing-restart'])
    assert.equal(routing[1].restartOf, 'routing-initial')
    assert.equal(routing[0].environment.QA_SCRIBE_E2E_APP_DATA_DIR, routing[1].environment.QA_SCRIBE_E2E_APP_DATA_DIR)
  }
})
test('missing failed skipped or incomplete isolation phase fails the gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'isolation-receipt-')); const path = join(root, 'outcome.json')
  const valid = { phase: 'initial', completed: true, scenarios: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, status: 'passed' })) }
  try {
    assert.equal(readIsolationEvidence(path, 'initial'), null)
    for (const patch of [{ completed: false }, { phase: 'restart' }, { scenarios: valid.scenarios.slice(1) }, { scenarios: [...valid.scenarios.slice(0, 5), { id: 6, status: 'failed' }] }, { scenarios: [...valid.scenarios.slice(0, 5), { id: 6, status: 'skipped' }] }, { scenarios: valid.scenarios.map(row => ({ ...row, id: 1 })) }]) {
      writeFileSync(path, JSON.stringify({ ...valid, ...patch })); assert.equal(readIsolationEvidence(path, 'initial'), null)
    }
    writeFileSync(path, JSON.stringify(valid)); assert.equal(readIsolationEvidence(path, 'initial').scenarios.length, 6)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
