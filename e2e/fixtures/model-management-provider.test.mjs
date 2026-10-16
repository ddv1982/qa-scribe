import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const frame = (request) => {
  const body = JSON.stringify(request)
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

function run(provider, mode, argv, requests, framed = false) {
  const directory = mkdtempSync(join(tmpdir(), 'qa-model-fixture-test-'))
  try {
    writeFileSync(join(directory, 'model-management.json'), JSON.stringify({ [provider]: mode }))
    const child = spawnSync(process.execPath, [fileURLToPath(new URL(`./bin/${provider}`, import.meta.url)), ...argv], {
      env: { ...process.env, QA_SCRIBE_E2E_MODEL_MANAGEMENT: '1', QA_SCRIBE_E2E_FIXTURE_DIR: directory },
      input: requests.map((request) => framed ? frame(request) : `${JSON.stringify(request)}\n`).join(''),
      encoding: 'utf8', timeout: 3_000,
    })
    assert.equal(child.status, 0, child.stderr)
    const observations = readFileSync(join(directory, 'model-management-journal.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    return { stdout: child.stdout, observations }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('Claude initialization returns the literal account model with no prompt', () => {
  const requests = [{ type: 'control_request', request_id: 'qa-scribe-model-catalog', request: { subtype: 'initialize' } }]
  const result = run('claude', 'fresh', ['--input-format', 'stream-json'], requests)
  assert.deepEqual(JSON.parse(result.stdout).response.response,
    { models: [{ value: 'claude-fixture', displayName: 'Claude Fixture', description: 'Synthetic account catalog' }] })
  assert.deepEqual(result.observations.filter((entry) => entry.event === 'request').map((entry) => entry.request), requests)
})

test('Codex replies with a cursor, a hidden model, and exactly the requested second page', () => {
  const result = run('codex', 'fresh', ['app-server'], [
    { id: 1, method: 'model/list', params: { limit: 100 } },
    { id: 2, method: 'model/list', params: { limit: 100, cursor: 'fixture-page-2' } },
  ])
  const pages = result.stdout.trim().split('\n').map((line) => JSON.parse(line).result)
  assert.deepEqual(pages, [
    { data: [{ model: 'codex-page-one', displayName: 'Codex Page One', hidden: false },
      { model: 'codex-hidden', displayName: 'Codex Hidden', hidden: true }], nextCursor: 'fixture-page-2' },
    { data: [{ model: 'codex-page-two', displayName: 'Codex Page Two', hidden: false }], nextCursor: null },
  ])
})

test('Copilot reproduces the string-only denial after authenticated status', () => {
  const result = run('copilot', 'denial', ['--server', '--stdio', '--no-auto-update'], [
    { id: 3, method: 'auth.getStatus' }, { id: 4, method: 'models.list' },
  ], true)
  assert.match(result.stdout, /"isAuthenticated":true/)
  const denial = JSON.parse(result.stdout.slice(result.stdout.lastIndexOf('\r\n\r\n') + 4))
  assert.deepEqual(denial.error, { code: -32603,
    message: 'Request models.list failed with message: 403 "unauthorized: not authorized to use this copilot feature\\n"' })
})

test('Copilot policy rows retain their exact disabled and unconfigured states', () => {
  const result = run('copilot', 'policy', ['--server'], [{ id: 4, method: 'models.list' }], true)
  assert.deepEqual(JSON.parse(result.stdout.split('\r\n\r\n')[1]).result.models, [
    { id: 'copilot-fixture', name: 'Copilot Fixture', policy: { state: 'enabled' } },
    { id: 'copilot-blocked', name: 'Copilot Blocked', policy: { state: 'disabled' } },
    { id: 'copilot-unconfigured', name: 'Copilot Unconfigured', policy: { state: 'unconfigured' } },
  ])
})

test('qualification catalogs return unique literal IDs and journal the actual response inventory', () => {
  const claude = run('claude', 'qualification', ['--input-format', 'stream-json'], [
    { type: 'control_request', request_id: 'qa-scribe-model-catalog', request: { subtype: 'initialize' } },
  ])
  assert.deepEqual(JSON.parse(claude.stdout).response.response.models,
    [{ value: 'qualification-claude-model', displayName: 'qualification-claude-model' }])
  assert.deepEqual(claude.observations.find((entry) => entry.event === 'catalog-response').ids, ['qualification-claude-model'])
  const codex = run('codex', 'qualification', ['app-server'], [{ id: 2, method: 'model/list', params: { limit: 100 } }])
  assert.deepEqual(JSON.parse(codex.stdout).result,
    { data: [{ model: 'qualification-codex-model', displayName: 'qualification-codex-model', hidden: false }], nextCursor: null })
  assert.deepEqual(codex.observations.find((entry) => entry.event === 'catalog-response').ids, ['qualification-codex-model'])
  const copilot = run('copilot', 'qualification', ['--server'], [{ id: 4, method: 'models.list' }], true)
  assert.deepEqual(JSON.parse(copilot.stdout.split('\r\n\r\n')[1]).result.models,
    [{ id: 'qualification-copilot-model', name: 'qualification-copilot-model', policy: { state: 'enabled' } }])
  assert.deepEqual(copilot.observations.find((entry) => entry.event === 'catalog-response').ids, ['qualification-copilot-model'])
})

test('policy refresh changes the same Copilot model from enabled to disabled', () => {
  const initial = run('copilot', 'fresh', ['--server'], [{ id: 4, method: 'models.list' }], true)
  const changed = run('copilot', 'policy-update', ['--server'], [{ id: 4, method: 'models.list' }], true)
  assert.deepEqual(JSON.parse(initial.stdout.split('\r\n\r\n')[1]).result.models,
    [{ id: 'copilot-fixture', name: 'Copilot Fixture', policy: { state: 'enabled' } }])
  assert.deepEqual(JSON.parse(changed.stdout.split('\r\n\r\n')[1]).result.models,
    [{ id: 'copilot-fixture', name: 'Copilot Fixture', policy: { state: 'disabled' } }])
})
