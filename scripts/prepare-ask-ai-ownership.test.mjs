import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareOwnershipFixture, ownershipFixtureSha256 } from './prepare-ask-ai-ownership.mjs'
import { createWdioInvocationPlan } from './run-e2e.mjs'

test('ownership lanes share only their isolated database across two native reopens', () => {
  const plan = createWdioInvocationPlan({ QA_SCRIBE_E2E_SPEC: 'ask-ai-ownership-migration.e2e.mjs' }, '/isolated', '/evidence')
  assert.deepEqual(plan.map(p => p.environment.QA_SCRIBE_E2E_OWNERSHIP_PHASE), ['initial', 'reopen-1', 'reopen-2'])
  assert.deepEqual(plan.map(p => p.environment.QA_SCRIBE_E2E_APP_DATA_DIR), Array(3).fill('/isolated/app-data'))
  assert.deepEqual(plan.map(p => p.restartOf ?? null), [null, 'ownership-initial', 'ownership-initial'])
  assert.equal(new Set(plan.map(p => p.environment.QA_SCRIBE_E2E_ARTIFACTS)).size, 3)
})

test('portable preparation copies exact frozen bytes and refuses to overwrite a migrated lane', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-ownership-fixture-'))
  try {
    prepareOwnershipFixture(dir)
    assert.equal(createHash('sha256').update(readFileSync(join(dir, 'qa-scribe.sqlite'))).digest('hex'), ownershipFixtureSha256)
    assert.deepEqual(readdirSync(join(dir, 'attachments')), ['perf-session'])
    assert.throws(() => prepareOwnershipFixture(dir), /fresh isolated app data/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
