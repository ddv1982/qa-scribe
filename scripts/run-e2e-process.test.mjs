import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWdioInvocationPlan, runE2e } from './run-e2e.mjs'
import { qualitySummary } from './write-quality-summary.mjs'

for (const skipBuild of ['0', '1']) {
  test(`invalid invocation plan fails with a receipt and removes owned data before any spawn (skip build ${skipBuild})`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-invalid-plan-test-'))
    const ownedTmp = join(directory, 'tmp')
    mkdirSync(ownedTmp)
    try {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { existsSync, readFileSync, readdirSync } from 'node:fs'
        import { runE2e } from ${JSON.stringify(new URL('./run-e2e.mjs', import.meta.url).href)}
        let status = null
        let thrown = null
        let spawns = 0
        try {
          status = runE2e({ QA_SCRIBE_E2E_SCENARIO: 'invalid-scenario',
            QA_SCRIBE_E2E_SKIP_BUILD: ${JSON.stringify(skipBuild)},
            QA_SCRIBE_E2E_ARTIFACTS: 'artifacts' }, {
            spawnSyncImpl() { spawns++; throw new Error('Invalid input must never spawn a command') },
          })
        } catch (error) { thrown = error.message }
        const receipt = existsSync('artifacts/latest-run.json')
          ? JSON.parse(readFileSync('artifacts/latest-run.json', 'utf8')) : null
        process.stdout.write(JSON.stringify({ status, thrown, spawns, receipt,
          retainedOwnedRoots: readdirSync(${JSON.stringify(ownedTmp)}) }))
      `], { cwd: directory, env: { ...process.env, TMPDIR: ownedTmp, TMP: ownedTmp, TEMP: ownedTmp },
        encoding: 'utf8', timeout: 5_000 })
      assert.equal(child.status, 0, child.stderr)
      const observation = JSON.parse(child.stdout)
      assert.deepEqual({ ...observation, receipt: observation.receipt?.status ?? null }, {
        status: 1, thrown: null, spawns: 0, receipt: 'failed', retainedOwnedRoots: [],
      })
      assert.deepEqual(observation.receipt.firstFailure, {
        stage: 'orchestration', message: 'Unknown critical E2E scenario: invalid-scenario',
      })
      assert.equal(observation.receipt.exitCode, 1)
      assert.equal(observation.receipt.isolatedDataRemoved, true)
      for (const key of ['commands', 'plannedInvocations', 'invocations']) assert.deepEqual(observation.receipt[key], [])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
}

for (const [platform, expectedCount] of [['linux', 20], ['darwin', 11]]) {
  test(`${platform} defaults register first use with independent state and receipts`, () => {
    const plan = createWdioInvocationPlan({}, '/tmp/owned', '/tmp/evidence', platform)
    assert.equal(plan.length, expectedCount)
    assert.deepEqual(plan.slice(0, 5).map(({ id }) => id), [
      'session-lifecycle', 'manual-testware', 'clipboard', 'generation-cancellation', 'summary-recovery',
    ])
    assert.deepEqual(plan.find(({ id }) => id === 'first-use'), {
      id: 'first-use', environment: {
        QA_SCRIBE_E2E_SPEC: 'first-use.e2e.mjs',
        ...(platform === 'linux' ? { GDK_BACKEND: 'x11' } : {}),
        QA_SCRIBE_E2E_APP_DATA_DIR: '/tmp/owned/app-data/first-use',
        QA_SCRIBE_E2E_ARTIFACTS: '/tmp/evidence/first-use',
        QA_SCRIBE_E2E_FIXTURE_DIR: '/tmp/owned/fixtures/first-use',
      },
    })
    assert.deepEqual(createWdioInvocationPlan({ QA_SCRIBE_E2E_SCENARIO: 'clipboard' }, '/tmp/owned', '/tmp/evidence', platform).map(({ id }) => id), ['clipboard'])
    const selected = createWdioInvocationPlan({ QA_SCRIBE_E2E_SPEC: 'first-use.e2e.mjs' }, '/tmp/owned', '/tmp/evidence', platform)
    assert.deepEqual(selected.map(({ id }) => id), ['first-use.e2e.mjs'])
    assert.equal(selected[0].environment.GDK_BACKEND, platform === 'linux' ? 'x11' : undefined)
  })
}

test('E2E retains running and completed build receipts and the first actual exit status', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-stage-receipts-'))
  const artifacts = join(directory, 'artifacts')
  try {
    const status = runE2e({ QA_SCRIBE_E2E_ARTIFACTS: artifacts }, {
      spawnSyncImpl(command, _args, options) {
        const receipt = JSON.parse(readFileSync(join(artifacts, 'latest-run.json')))
        assert.equal(receipt.status, 'running')
        assert.equal(receipt.commands.at(-1).status, 'running')
        assert.equal(options.killSignal, 'SIGKILL')
        assert.equal(options.timeout, command === 'bun' ? 180_000 : 600_000)
        return command === 'bun' ? { status: 0 } : { status: 17, signal: null }
      },
    })
    assert.equal(status, 17)
    const receipt = JSON.parse(readFileSync(join(artifacts, 'latest-run.json')))
    assert.deepEqual(receipt.commands.map(({ stage, status }) => [stage, status]), [['frontend-build', 'passed'], ['native-build', 'failed']])
    assert.equal(receipt.firstFailure.exitCode, 17)
    assert.equal(receipt.isolatedDataRemoved, true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

for (const mode of ['spawn-error', 'timeout']) {
  test(`E2E ${mode} records real owned process failure and executes later invocations`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-real-failure-'))
    const artifacts = join(directory, 'artifacts', 'e2e')
    const pidPath = join(directory, 'pid')
    const invoked = []
    try {
      const status = runE2e({ QA_SCRIBE_E2E_SKIP_BUILD: '1', CI: 'true', QA_SCRIBE_AC3_RECORD: '1',
        QA_SCRIBE_E2E_TEMP_ROOT: join(directory, 'profile'), QA_SCRIBE_E2E_ARTIFACTS: artifacts }, {
        spawnSyncImpl(command, args, options) {
          assert.equal(options.env.QA_SCRIBE_AC3_RECORD, undefined)
          if (command === 'python3') return { status: 0 }
          assert.equal(options.timeout, options.env.QA_SCRIBE_E2E_SPEC === 'ui-polish.e2e.mjs' ? 420_000 : 180_000)
          invoked.push(options.env.QA_SCRIBE_E2E_SPEC)
          if (invoked.length === 1) {
            return mode === 'spawn-error'
              ? spawnSync(join(directory, 'missing-executable'), [], options)
              : spawnSync(process.execPath, ['-e', `require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)`, pidPath], { ...options, timeout: 250 })
          }
          return { status: 23, stdout: '', stderr: '' }
        },
      })
      assert.equal(status, 1)
      const plan = createWdioInvocationPlan({}, join(directory, 'profile'), artifacts)
      assert.equal(invoked.length, plan.length)
      const receipt = JSON.parse(readFileSync(join(artifacts, 'latest-run.json')))
      assert.equal(receipt.invocations.length, plan.length)
      assert.equal(receipt.firstFailure.spawnError.code, mode === 'timeout' ? 'ETIMEDOUT' : 'ENOENT')
      assert.equal(receipt.firstFailure.timedOut, mode === 'timeout')
      assert.equal(receipt.firstFailure.signal, mode === 'timeout' ? 'SIGKILL' : null)
      const summary = qualitySummary(directory, {})
      assert.match(summary, /First failure: session-lifecycle/)
      assert.match(summary, mode === 'timeout' ? /spawn error: ETIMEDOUT/ : /spawn error: ENOENT/)
      if (mode === 'timeout') {
        const pid = Number(readFileSync(pidPath, 'utf8'))
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
      }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
}
