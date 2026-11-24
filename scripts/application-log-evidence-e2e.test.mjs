import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { installAzFixture } from './application-log-evidence-e2e.mjs'
import { createWdioInvocationPlan } from './run-e2e.mjs'

test('log evidence restarts with the same isolated Azure configuration and app data', () => {
  for (const platform of ['linux', 'darwin']) {
    const spec = 'test-run-log-evidence.e2e.mjs'
    const standalone = createWdioInvocationPlan({ QA_SCRIBE_E2E_SPEC: spec }, '/tmp/root', '/tmp/artifacts', platform)
    const gate = createWdioInvocationPlan({}, '/tmp/root', '/tmp/artifacts', platform)
    for (const [capture, restart] of [standalone, gate.filter(({ environment }) => environment.QA_SCRIBE_E2E_SPEC === spec)]) {
      assert.equal(capture.id, 'test-run-log-evidence')
      assert.equal(restart.restartOf, capture.id)
      assert.deepEqual([capture.environment.QA_SCRIBE_E2E_LOG_PHASE, restart.environment.QA_SCRIBE_E2E_LOG_PHASE], ['capture', 'restart'])
      for (const key of ['AZURE_CONFIG_DIR', 'QA_SCRIBE_E2E_APP_DATA_DIR', 'QA_SCRIBE_E2E_FIXTURE_DIR']) {
        assert.ok(capture.environment[key].startsWith('/tmp/root/'))
        assert.equal(restart.environment[key], capture.environment[key])
      }
      assert.notEqual(restart.environment.QA_SCRIBE_E2E_ARTIFACTS, capture.environment.QA_SCRIBE_E2E_ARTIFACTS)
    }
  }
  const windows = createWdioInvocationPlan({}, '/tmp/root', '/tmp/artifacts', 'win32')
  assert.ok(!windows.some(({ id }) => id.startsWith('test-run-log-evidence')))
})

test('only the Azure evidence workflow installs fake az into its provider path', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-az-fixture-'))
  try {
    const providerBin = join(root, 'provider-bin')
    mkdirSync(providerBin)
    const fixtureBin = join(root, 'fixtures')
    const az = join(providerBin, 'az')
    installAzFixture({}, fixtureBin, providerBin)
    assert.equal(existsSync(az), false)
    const [capture, restart] = createWdioInvocationPlan(
      { QA_SCRIBE_E2E_SPEC: 'test-run-log-evidence.e2e.mjs' }, root, join(root, 'evidence'))
    for (const { environment } of [capture, restart]) {
      installAzFixture(environment, fixtureBin, providerBin)
      assert.equal(readlinkSync(az), join(fixtureBin, 'az'))
      assert.ok(existsSync(environment.AZURE_CONFIG_DIR))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fake az accepts the query file when the working directory has a symlink alias', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-az-cwd-'))
  try {
    const physical = join(root, 'physical')
    const alias = join(root, 'alias')
    const config = join(root, 'azure-config')
    mkdirSync(physical)
    mkdirSync(config)
    symlinkSync(physical, alias, 'dir')
    writeFileSync(join(physical, 'check.kql'), 'print access = 1')
    writeFileSync(join(config, 'mode'), 'extension-missing')
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../e2e/fixtures/bin/az', import.meta.url)),
      'monitor', 'app-insights', 'query', '--apps',
      '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/qa/providers/Microsoft.Insights/components/checkout',
      '--analytics-query', '@' + join(alias, 'check.kql'),
      '--start-time', '2026-11-24T10:00:00Z', '--end-time', '2026-11-24T10:15:00Z', '-o', 'json',
    ], { cwd: physical, encoding: 'utf8', env: {
      AZURE_CONFIG_DIR: config,
      QA_SCRIBE_E2E_FIXTURE_DIR: join(root, 'fixtures'),
      AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no',
      AZURE_CORE_COLLECT_TELEMETRY: 'no',
      AZURE_LOGGING_ENABLE_LOG_FILE: 'false',
    } })
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stderr, /app-insights.*not recognized/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
