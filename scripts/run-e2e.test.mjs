import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { once } from 'node:events'

import { createWdioInvocationPlan, criticalScenarios, executeWdioInvocations, runE2e } from './run-e2e.mjs'

test('critical workflows use separate WDIO processes, app data, fixtures, and artifacts', () => {
  const plan = createWdioInvocationPlan({}, '/tmp/e2e-root', '/tmp/e2e-artifacts')

  assert.deepEqual(plan.map(({ id }) => id), criticalScenarios)
  for (const key of ['QA_SCRIBE_E2E_APP_DATA_DIR', 'QA_SCRIBE_E2E_ARTIFACTS', 'QA_SCRIBE_E2E_FIXTURE_DIR']) {
    assert.equal(new Set(plan.map(({ environment }) => environment[key])).size, criticalScenarios.length)
  }
  assert.ok(plan.every(({ environment }) => environment.QA_SCRIBE_E2E_SPEC === 'critical-workflows.e2e.mjs'))
})

test('an explicit non-critical spec runs once with the supplied app-data root', () => {
  const plan = createWdioInvocationPlan(
    { QA_SCRIBE_E2E_SPEC: 'startup-performance.benchmark.mjs' },
    '/tmp/startup-root',
    '/tmp/startup-artifacts',
  )

  assert.equal(plan.length, 1)
  assert.equal(plan[0].environment.QA_SCRIBE_E2E_APP_DATA_DIR, join('/tmp/startup-root', 'app-data'))
  assert.equal(plan[0].environment.QA_SCRIBE_E2E_ARTIFACTS, '/tmp/startup-artifacts')
  assert.equal(plan[0].environment.QA_SCRIBE_E2E_SCENARIO, undefined)
})

test('a failed critical workflow does not prevent later workflow invocations', () => {
  const invoked = []
  const plan = criticalScenarios.map((id) => ({ id }))
  const result = executeWdioInvocations(plan, ({ id }) => {
    invoked.push(id)
    return { status: id === 'manual-testware' ? 9 : 0, signal: null }
  })

  assert.deepEqual(invoked, criticalScenarios)
  assert.equal(result.status, 9)
  assert.deepEqual(result.results.map(({ status }) => status), criticalScenarios.map((id) => id === 'manual-testware' ? 9 : 0))
})

test('an interrupted E2E build never targets or rebuilds the production frontend', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'qa-scribe-runner-'))
  const calls = []
  try {
    const status = runE2e(
      {
        ...process.env,
        QA_SCRIBE_E2E_TEMP_ROOT: join(temporaryRoot, 'isolated'),
        QA_SCRIBE_E2E_ARTIFACTS: join(temporaryRoot, 'artifacts'),
        VITE_QA_SCRIBE_E2E: 'inherited-value-must-be-removed',
      },
      {
        spawnSyncImpl(command, args, options) {
          calls.push({ command, args, environment: options.env })
          return { status: command === 'cargo' ? 2 : 0, signal: null }
        },
      },
    )

    assert.equal(status, 1)
    assert.deepEqual(calls.map(({ command }) => command), ['bun', 'cargo'])
    assert.equal(calls[0].environment.VITE_QA_SCRIBE_E2E, '1')
    assert.deepEqual(calls[0].args.slice(0, 4), ['run', '--cwd', 'frontend', 'build'])
    const outputIndex = calls[0].args.indexOf('--outDir')
    assert.notEqual(outputIndex, -1)
    assert.equal(calls[0].args[outputIndex + 1], join(temporaryRoot, 'isolated', 'frontend-dist'))
    assert.notEqual(calls[0].args[outputIndex + 1], resolve('frontend/dist'))
    const tauriConfig = JSON.parse(calls[1].environment.TAURI_CONFIG)
    assert.equal(tauriConfig.build.frontendDist, join(temporaryRoot, 'isolated', 'frontend-dist'))
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

for (const [label, wdioStatus] of [['successful', 0], ['failed', 4]]) {
  test(`a ${label} E2E invocation uses only the isolated frontend build`, () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'qa-scribe-runner-'))
    const calls = []
    try {
      const status = runE2e(
        {
          ...process.env,
          QA_SCRIBE_E2E_TEMP_ROOT: join(temporaryRoot, 'isolated'),
          QA_SCRIBE_E2E_ARTIFACTS: join(temporaryRoot, 'artifacts'),
          QA_SCRIBE_E2E_SPEC: 'single-workflow.e2e.mjs',
        },
        {
          spawnSyncImpl(command, args, options) {
            calls.push({ command, args, environment: options.env, maxBuffer: options.maxBuffer })
            return { status: command.includes('wdio') ? wdioStatus : 0, signal: null, stdout: '', stderr: '' }
          },
        },
      )

      assert.equal(status, wdioStatus)
      assert.equal(calls.filter(({ command }) => command === 'bun').length, 1)
      assert.equal(calls.filter(({ command }) => command === 'cargo').length, 1)
      const frontendBuild = calls.find(({ command }) => command === 'bun')
      const wdioRun = calls.find(({ command }) => command.includes('wdio'))
      const outputIndex = frontendBuild.args.indexOf('--outDir')
      assert.equal(frontendBuild.args[outputIndex + 1], join(temporaryRoot, 'isolated', 'frontend-dist'))
      assert.equal(wdioRun.maxBuffer, 64 * 1024 * 1024)
      assert.ok(calls.every(({ args }) => !args.includes(resolve('frontend/dist'))))
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
}

test('shared and standalone callers build production assets independently when needed', () => {
  const action = readFileSync('.github/actions/run-built-app-e2e/action.yml', 'utf8')
  const benchmark = readFileSync('scripts/run-startup-benchmark.mjs', 'utf8')

  assert.match(action, /bun run frontend:build && bun run e2e:isolation/)
  assert.match(benchmark, /if \(!existsSync\(join\(root, 'frontend', 'dist', 'assets'\)\)\)/)
  assert.match(benchmark, /run\('bun', \['run', 'frontend:build'\]\)/)
})

test('the Codex fixture completes only released invocations and leaves cancellation pending', { timeout: 5_000 }, async () => {
  const controlDirectory = mkdtempSync(join(tmpdir(), 'qa-scribe-codex-fixture-'))
  const fixture = resolve('e2e/fixtures/bin/codex')
  const children = []
  try {
    const first = startFixture(fixture, controlDirectory)
    children.push(first.child)
    first.child.stdin.end('Create test scenarios with test cases from the selected note only')
    await waitForPath(join(controlDirectory, 'codex-exec-1.started'))
    assert.doesNotMatch(first.output(), /item\.completed/)
    writeFileSync(join(controlDirectory, 'codex-exec-1.release'), 'release\n')
    const [firstCode] = await once(first.child, 'close')
    assert.equal(firstCode, 0)
    assert.match(first.output(), /Deterministic generated case/)
    assert.match(first.output(), /item\.completed/)

    const second = startFixture(fixture, controlDirectory)
    children.push(second.child)
    second.child.stdin.end('Create test scenarios with test cases from the selected note only')
    await waitForPath(join(controlDirectory, 'codex-exec-2.started'))
    second.child.kill('SIGTERM')
    await once(second.child, 'close')
    assert.equal(existsSync(join(controlDirectory, 'codex-exec-2.release')), false)
    assert.doesNotMatch(second.output(), /item\.completed/)
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    rmSync(controlDirectory, { recursive: true, force: true })
  }
})

function startFixture(fixture, controlDirectory) {
  let output = ''
  const child = spawn(process.execPath, [fixture, 'exec', '--json'], {
    env: { ...process.env, QA_SCRIBE_E2E_FIXTURE_DIR: controlDirectory },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  return { child, output: () => output }
}

function waitForPath(path) {
  if (existsSync(path)) return Promise.resolve()
  return new Promise((resolvePromise, reject) => {
    const watcher = watch(dirname(path), () => {
      if (!existsSync(path)) return
      clearTimeout(timeout)
      watcher.close()
      resolvePromise()
    })
    const timeout = setTimeout(() => {
      watcher.close()
      reject(new Error(`Timed out waiting for ${path}`))
    }, 2_000)
    if (existsSync(path)) {
      clearTimeout(timeout)
      watcher.close()
      resolvePromise()
    }
  })
}
