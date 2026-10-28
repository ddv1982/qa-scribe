import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { once } from 'node:events'

import { createWdioInvocationPlan, criticalScenarios, executeWdioInvocations, readExecutionEvidence, readModelLaneEvidence, readQualificationEvidence, runE2e } from './run-e2e.mjs'

test('critical workflows use separate WDIO processes, app data, fixtures, and artifacts', () => {
  const plan = createWdioInvocationPlan({}, '/tmp/e2e-root', '/tmp/e2e-artifacts')

  assert.deepEqual(plan.slice(0, criticalScenarios.length).map(({ id }) => id), criticalScenarios)
  const legacy = plan.slice(0, criticalScenarios.length + 4 + (['linux', 'darwin'].includes(process.platform) ? 3 : 0) + (process.platform === 'linux' ? 1 : 0))
  assert.deepEqual(legacy.slice(criticalScenarios.length).map(({ id }) => id), [
    'chat-images', 'chat-tool-authorization-codex', 'chat-tool-authorization-claude', 'chat-tool-authorization-copilot',
    ...(['linux', 'darwin'].includes(process.platform) ? ['manual-formats', 'ui-polish', 'first-use'] : []),
    ...(process.platform === 'linux' ? ['native-close'] : []),
  ])
  for (const key of ['QA_SCRIBE_E2E_APP_DATA_DIR', 'QA_SCRIBE_E2E_ARTIFACTS', 'QA_SCRIBE_E2E_FIXTURE_DIR']) {
    assert.equal(new Set(legacy.map(({ environment }) => environment[key])).size, legacy.length)
  }
  assert.ok(plan.slice(0, criticalScenarios.length).every(({ environment }) => environment.QA_SCRIBE_E2E_SPEC === 'critical-workflows.e2e.mjs'))
  assert.equal(plan[criticalScenarios.length].environment.QA_SCRIBE_E2E_SPEC, 'chat-images.e2e.mjs')
  assert.equal(plan.some(({ id }) => id === 'chat-to-note'), false)
  assert.equal(createWdioInvocationPlan({ QA_SCRIBE_E2E_SPEC: 'chat-to-note.e2e.mjs' }, '/tmp/root', '/tmp/artifacts')[0].environment.QA_SCRIBE_E2E_SPEC, 'chat-to-note.e2e.mjs')
  for (const [index, provider] of ['codex', 'claude', 'copilot'].entries()) {
    const environment = plan[criticalScenarios.length + 1 + index].environment
    assert.equal(environment.QA_SCRIBE_E2E_SPEC, 'chat-tool-authorization.workflow.mjs')
    assert.equal(environment.QA_SCRIBE_E2E_AUTH_PROVIDER, provider)
  }
})

test('UI polish runs with isolated artifacts in supported desktop defaults', () => {
  for (const platform of ['linux', 'darwin']) {
    const plan = createWdioInvocationPlan({}, '/tmp/root', '/tmp/artifacts', platform)
    const polish = plan.find(({ id }) => id === 'ui-polish')
    assert.deepEqual(polish.environment, {
      QA_SCRIBE_E2E_SPEC: 'ui-polish.e2e.mjs',
      ...(platform === 'linux' ? { GDK_BACKEND: 'x11' } : {}),
      QA_SCRIBE_E2E_APP_DATA_DIR: '/tmp/root/app-data/ui-polish',
      QA_SCRIBE_E2E_ARTIFACTS: '/tmp/artifacts/ui-polish',
      QA_SCRIBE_E2E_FIXTURE_DIR: '/tmp/root/fixtures/ui-polish',
    })
    const selected = createWdioInvocationPlan({ QA_SCRIBE_E2E_SPEC: 'ui-polish.e2e.mjs' }, '/tmp/root', '/tmp/artifacts', platform)
    assert.equal(selected[0].environment.GDK_BACKEND, platform === 'linux' ? 'x11' : undefined)
    assert.ok(plan.filter(({ id }) => id !== 'ui-polish').every(({ environment }) =>
      environment.QA_SCRIBE_E2E_APP_DATA_DIR !== polish.environment.QA_SCRIBE_E2E_APP_DATA_DIR))
  }
})

test('Chat images is a required isolated default and an explicit invocation enables the same fixture', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const plan = createWdioInvocationPlan({}, '/tmp/root', '/tmp/artifacts', platform)
    assert.deepEqual(plan.find(({ id }) => id === 'chat-images'), {
      id: 'chat-images', environment: {
        QA_SCRIBE_E2E_SPEC: 'chat-images.e2e.mjs', QA_SCRIBE_E2E_CHAT_IMAGES: '1',
        QA_SCRIBE_E2E_APP_DATA_DIR: '/tmp/root/app-data/chat-images',
        QA_SCRIBE_E2E_ARTIFACTS: '/tmp/artifacts/chat-images',
        QA_SCRIBE_E2E_FIXTURE_DIR: '/tmp/root/fixtures/chat-images',
      },
    })
    assert.deepEqual(plan.filter(({ environment }) => environment.QA_SCRIBE_E2E_CHAT_IMAGES).map(({ id }) => id), ['chat-images'])
    const explicit = createWdioInvocationPlan({ QA_SCRIBE_E2E_SPEC: 'chat-images.e2e.mjs' }, '/tmp/root', '/tmp/artifacts', platform)
    assert.equal(explicit.length, 1)
    assert.equal(explicit[0].environment.QA_SCRIBE_E2E_CHAT_IMAGES, '1')
  }
})

test('native close is a required Linux default workflow and excluded on other platforms', () => {
  const linux = createWdioInvocationPlan({}, '/tmp/root', '/tmp/artifacts', 'linux')
  const nativeClose = linux.find(({ id }) => id === 'native-close')
  assert.equal(nativeClose.environment.QA_SCRIBE_E2E_SPEC, 'native-close.e2e.mjs')
  assert.equal(nativeClose.environment.GDK_BACKEND, 'x11')
  const explicit = createWdioInvocationPlan({ QA_SCRIBE_E2E_SPEC: 'native-close.e2e.mjs' }, '/tmp/root', '/tmp/artifacts', 'linux')
  assert.equal(explicit[0].environment.GDK_BACKEND, 'x11')
  for (const platform of ['darwin', 'win32']) {
    const plan = createWdioInvocationPlan({}, '/tmp/root', '/tmp/artifacts', platform)
    assert.equal(plan.some(({ id }) => id === 'native-close'), false)
  }
  const selected = createWdioInvocationPlan({ QA_SCRIBE_E2E_SCENARIO: 'clipboard' }, '/tmp/root', '/tmp/artifacts', 'linux')
  assert.deepEqual(selected.map(({ id }) => id), ['clipboard'])
})

test('explicit model selection uses X11 and remains exactly one invocation', () => {
  const plan = createWdioInvocationPlan({ QA_SCRIBE_E2E_SPEC: 'model-selection.e2e.mjs' }, '/tmp/root', '/tmp/artifacts', 'linux')
  assert.equal(plan.length, 1)
  assert.equal(plan[0].environment.GDK_BACKEND, 'x11')
  assert.equal(plan[0].environment.QA_SCRIBE_E2E_SPEC, 'model-selection.e2e.mjs')
})

test('Linux defaults require the complete model proof chain while non-Linux defaults retain their supported workflows', () => {
  const linux = createWdioInvocationPlan({}, '/tmp/root', '/tmp/artifacts', 'linux')
  assert.deepEqual(linux.map(({ id }) => id), [
    ...criticalScenarios, 'chat-images', 'chat-tool-authorization-codex', 'chat-tool-authorization-claude',
    'chat-tool-authorization-copilot', 'manual-formats', 'ui-polish', 'first-use', 'native-close', 'ask-ai-isolation-initial', 'model-management', 'model-evidence', 'model-evidence-restart',
    'model-selection', 'model-selection-restart', 'provider-qualification-disabled', 'provider-qualification-diagnostics',
    'provider-qualification-selector',
  ])
  assert.equal(linux.find(({ id }) => id === 'model-selection').environment.GDK_BACKEND, 'x11')
  for (const platform of ['darwin', 'win32']) {
    assert.deepEqual(createWdioInvocationPlan({}, '/tmp/root', '/tmp/artifacts', platform).map(({ id }) => id), [
      ...criticalScenarios, 'chat-images', 'chat-tool-authorization-codex', 'chat-tool-authorization-claude', 'chat-tool-authorization-copilot',
      ...(platform === 'darwin' ? ['manual-formats', 'ui-polish', 'first-use', 'ask-ai-isolation-initial'] : []),
    ])
  }
})

test('only each evidence and selection restart shares its own proof state and every invocation has separate runner artifacts', () => {
  const plan = createWdioInvocationPlan({}, '/tmp/root', '/tmp/artifacts', 'linux')
  assert.equal(new Set(plan.map(({ environment }) => environment.QA_SCRIBE_E2E_ARTIFACTS)).size, plan.length)
  for (const [id, flag] of [['model-evidence', 'QA_SCRIBE_E2E_EVIDENCE_RESTART'], ['model-selection', 'QA_SCRIBE_E2E_SELECTION_RESTART']]) {
    const initial = plan.find((entry) => entry.id === id)
    const restart = plan.find((entry) => entry.id === `${id}-restart`)
    assert.equal(restart.restartOf, id)
    assert.equal(initial.environment[flag], '0')
    assert.equal(restart.environment[flag], '1')
    for (const key of ['QA_SCRIBE_E2E_APP_DATA_DIR', 'QA_SCRIBE_E2E_FIXTURE_DIR', 'QA_SCRIBE_E2E_MODEL_EVIDENCE']) {
      assert.equal(restart.environment[key], initial.environment[key])
      assert.ok(plan.filter((entry) => ![id, `${id}-restart`].includes(entry.id)).every((entry) => entry.environment[key] !== initial.environment[key]))
    }
  }
  for (const entry of plan.filter(({ id }) => id.startsWith('model-') || id.startsWith('provider-qualification-'))) {
    assert.ok(entry.environment.QA_SCRIBE_E2E_MODEL_EVIDENCE.startsWith('/tmp/artifacts/'))
  }
})

test('model proof receipts require ten ordered successful lanes and actual completed restart evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-model-receipt-'))
  const path = join(directory, 'lanes.json')
  const initial = { phase: 'M02', passed: 10, completed: false, nativeRestartVerified: false,
    results: Array.from({ length: 10 }, (_, index) => ({ lane: index + 1, status: 'passed' })) }
  try {
    writeFileSync(path, JSON.stringify(initial))
    assert.deepEqual(readModelLaneEvidence(path, 'M02', false), initial)
    assert.equal(readModelLaneEvidence(path, 'M02', true), null)
    const complete = { ...initial, completed: true, nativeRestartVerified: true }
    writeFileSync(path, JSON.stringify(complete))
    assert.deepEqual(readModelLaneEvidence(path, 'M02', true), complete)
    for (const patch of [{ passed: 9 }, { phase: 'M03' }, { nativeRestartVerified: false },
      { results: initial.results.slice(0, 9) }, { results: initial.results.map((lane) => lane.lane === 8 ? { ...lane, status: 'failed' } : lane) }]) {
      writeFileSync(path, JSON.stringify({ ...complete, ...patch }))
      assert.equal(readModelLaneEvidence(path, 'M02', true), null)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('qualification receipts cover only the actual mode-specific deterministic lanes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-qualification-receipt-'))
  const path = join(directory, 'qualification.json')
  try {
    for (const [mode, lanes] of [['disabled', [4]], ['diagnostics', [5]], ['selector', [6, 7, 8]]]) {
      const complete = { phase: 'M04', mode, completed: true, results: lanes.map((lane) => ({ lane, status: 'passed' })) }
      writeFileSync(path, JSON.stringify(complete))
      assert.deepEqual(readQualificationEvidence(path, mode), complete)
      writeFileSync(path, JSON.stringify({ ...complete, completed: false }))
      assert.equal(readQualificationEvidence(path, mode), null)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('machine execution evidence rejects skipped, failed, empty, incomplete and mismatched runs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-execution-evidence-'))
  const path = join(directory, 'wdio-execution.json')
  const valid = { version: 1, spec: 'workflow.e2e.mjs', completed: true, passed: 1, failed: 0, skipped: 0 }
  try {
    assert.equal(readExecutionEvidence(path, valid.spec), null)
    for (const patch of [{ passed: 0 }, { skipped: 1 }, { failed: 1 }, { completed: false }, { spec: 'other.mjs' }, { passed: '1' }]) {
      writeFileSync(path, JSON.stringify({ ...valid, ...patch }))
      assert.equal(readExecutionEvidence(path, valid.spec), null)
    }
    writeFileSync(path, JSON.stringify(valid))
    assert.deepEqual(readExecutionEvidence(path, valid.spec), valid)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const output of ['', '1 passing (1s)\n', '0 passing\n1 pending\n']) {
  test(`zero-exit WDIO without trusted execution evidence fails (${JSON.stringify(output)})`, () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'qa-scribe-no-coverage-'))
    try {
      const status = runE2e({
        ...process.env,
        QA_SCRIBE_E2E_SKIP_BUILD: '1',
        QA_SCRIBE_E2E_TEMP_ROOT: join(temporaryRoot, 'isolated'),
        QA_SCRIBE_E2E_ARTIFACTS: join(temporaryRoot, 'artifacts'),
        QA_SCRIBE_E2E_SPEC: 'chat-tool-authorization.workflow.mjs',
      }, {
        spawnSyncImpl() { return { status: 0, signal: null, stdout: output, stderr: '' } },
      })
      assert.notEqual(status, 0, 'A successful process exit or human-readable passing text does not prove spec execution')
      const metadata = JSON.parse(readFileSync(join(temporaryRoot, 'artifacts/latest-run.json'), 'utf8'))
      assert.equal(metadata.status, 'failed')
      assert.notEqual(metadata.invocations[0].status, 0)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
}

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

    assert.equal(status, 2)
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
            if (command.includes('wdio') && wdioStatus === 0) {
              writeFileSync(options.env.QA_SCRIBE_E2E_EXECUTION_EVIDENCE, JSON.stringify({
                version: 1, spec: options.env.QA_SCRIBE_E2E_SPEC, completed: true, passed: 1, failed: 0, skipped: 0,
              }))
            }
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

test('inherited provider home overrides never escape the isolated fixture home', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-hostile-provider-env-'))
  let applicationEnvironment
  try {
    const status = runE2e({ ...process.env, QA_SCRIBE_E2E_SKIP_BUILD: '1', QA_SCRIBE_E2E_SPEC: 'single-workflow.e2e.mjs',
      QA_SCRIBE_E2E_TEMP_ROOT: join(directory, 'native'), QA_SCRIBE_E2E_ARTIFACTS: join(directory, 'artifacts'),
      CODEX_HOME: '/untrusted-host/codex', CLAUDE_CONFIG_DIR: '/untrusted-host/claude', COPILOT_HOME: '/untrusted-host/copilot' }, {
      spawnSyncImpl(_command, _args, options) {
        applicationEnvironment = options.env
        writeFileSync(options.env.QA_SCRIBE_E2E_EXECUTION_EVIDENCE, JSON.stringify({ version: 1,
          spec: options.env.QA_SCRIBE_E2E_SPEC, completed: true, passed: 1, failed: 0, skipped: 0 }))
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    assert.equal(status, 0)
    assert.equal(applicationEnvironment.CODEX_HOME, join(directory, 'native', 'home', '.codex'))
    assert.equal(applicationEnvironment.CLAUDE_CONFIG_DIR, join(directory, 'native', 'home', '.claude'))
    assert.equal(applicationEnvironment.COPILOT_HOME, join(directory, 'native', 'home', '.copilot'))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('default execution preserves migrated pair state through restart and isolates all unrelated workflow homes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-default-model-pairs-'))
  const homes = new Map()
  const seeds = []
  const restartChecks = []
  try {
    const status = runE2e({ ...process.env, QA_SCRIBE_E2E_SKIP_BUILD: '1', QA_SCRIBE_E2E_TEMP_ROOT: join(directory, 'native'),
      QA_SCRIBE_E2E_ARTIFACTS: join(directory, 'artifacts'), QA_SCRIBE_E2E_CHAT_IMAGES: 'inherited-value-must-not-leak' }, {
      spawnSyncImpl(command, args, options) {
        const env = options.env
        if (command === 'python3') {
          if (args[1] === 'seed') {
            assert.equal(existsSync(args[2]), false, 'A real restart must never reseed the migrated database')
            writeFileSync(args[2], 'schema-10-seed')
            seeds.push(env.QA_SCRIBE_E2E_APP_DATA_DIR)
          }
          return { status: 0, stdout: '', stderr: '' }
        }
        const spec = env.QA_SCRIBE_E2E_SPEC
        assert.equal(env.QA_SCRIBE_E2E_CHAT_IMAGES, spec === 'chat-images.e2e.mjs' ? '1' : undefined)
        if (spec === 'chat-images.e2e.mjs') assert.equal(env.QA_SCRIBE_PROVIDER_CATALOG_MODE, 'selector')
        const isolation = spec === 'ask-ai-conversation-isolation.e2e.mjs'
        const restarting = env.QA_SCRIBE_E2E_EVIDENCE_RESTART === '1' || env.QA_SCRIBE_E2E_SELECTION_RESTART === '1'
        const state = join(env.QA_SCRIBE_E2E_APP_DATA_DIR, 'retained-model-state')
        const peer = join(env.QA_SCRIBE_E2E_FIXTURE_DIR, 'retained-model-peer')
        const modelPhase = { 'model-management.e2e.mjs': 'M01', 'model-evidence.e2e.mjs': 'M02', 'model-selection.e2e.mjs': 'M03' }[spec]
        const pair = ['model-evidence.e2e.mjs', 'model-selection.e2e.mjs'].includes(spec)
        if (restarting) {
          assert.equal(readFileSync(state, 'utf8'), spec)
          assert.equal(readFileSync(peer, 'utf8'), spec)
          if (!isolation) assert.equal(readFileSync(join(env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite'), 'utf8'), 'migrated-schema-11')
          assert.equal(env.HOME, homes.get(env.QA_SCRIBE_E2E_APP_DATA_DIR))
          restartChecks.push(spec)
        } else {
          assert.equal(existsSync(state), false)
          writeFileSync(state, spec)
          writeFileSync(peer, spec)
          homes.set(env.QA_SCRIBE_E2E_APP_DATA_DIR, env.HOME)
          if (pair) {
            assert.equal(readFileSync(join(env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite'), 'utf8'), 'schema-10-seed')
            writeFileSync(join(env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite'), 'migrated-schema-11')
          }
        }
        if (isolation) writeFileSync(join(env.QA_SCRIBE_E2E_ARTIFACTS, 'isolation-outcomes.json'), JSON.stringify({ phase: env.QA_SCRIBE_E2E_ISOLATION_PHASE, completed: true, scenarios: [1, 2, 3, 4, 5, 6].map(id => ({ id, status: 'passed' })) }))
        if (modelPhase) writeFileSync(join(env.QA_SCRIBE_E2E_MODEL_EVIDENCE, 'lane-results.json'), JSON.stringify({
          phase: modelPhase, passed: 10, completed: modelPhase === 'M01' || restarting, nativeRestartVerified: restarting,
          results: Array.from({ length: 10 }, (_, index) => ({ lane: index + 1, status: 'passed' })),
        }))
        if (spec === 'provider-qualification.e2e.mjs') writeFileSync(join(env.QA_SCRIBE_E2E_MODEL_EVIDENCE, 'qualification-results.json'), JSON.stringify({
          phase: 'M04', mode: env.QA_SCRIBE_PROVIDER_CATALOG_MODE, completed: true,
          results: { disabled: [4], diagnostics: [5], selector: [6, 7, 8] }[env.QA_SCRIBE_PROVIDER_CATALOG_MODE].map((lane) => ({ lane, status: 'passed' })),
        }))
        writeFileSync(env.QA_SCRIBE_E2E_EXECUTION_EVIDENCE, JSON.stringify({ version: 1, spec,
          completed: true, passed: 1, failed: 0, skipped: 0 }))
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    assert.equal(status, 0)
    assert.equal(new Set(homes.values()).size, homes.size, 'Only intentional restart pairs share one fixture HOME')
    assert.equal(new Set(seeds).size, seeds.length)
    assert.deepEqual(restartChecks, process.platform === 'linux' ? ['model-evidence.e2e.mjs', 'model-selection.e2e.mjs'] : [])
    assert.equal(seeds.length, process.platform === 'linux' ? 2 : 0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('shared and standalone callers build production assets independently when needed', () => {
  const action = readFileSync('.github/actions/run-built-app-e2e/action.yml', 'utf8')
  const benchmark = readFileSync('scripts/run-startup-benchmark.mjs', 'utf8')

  assert.match(action, /bun run frontend:build && bun run e2e:isolation/)
  assert.match(benchmark, /if \(!existsSync\(join\(root, 'frontend', 'dist', 'assets'\)\)\)/)
  assert.match(benchmark, /run\('frontend-build', 'bun', \['run', 'frontend:build'\]\)/)
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

test('the Codex fixture accepts the current production Chat prompt and inherited tools', { timeout: 5_000 }, async () => {
  const controlDirectory = mkdtempSync(join(tmpdir(), 'qa-scribe-chat-fixture-'))
  const version = readFileSync('crates/qa-scribe-core/src/chat/mod.rs', 'utf8')
    .match(/CHAT_PROMPT_VERSION: &str = "([^"]+)"/)?.[1]
  assert.ok(version)
  const running = startFixture(resolve('e2e/fixtures/bin/codex'), controlDirectory, ['exec', '--json', '--ephemeral', '-'])
  try {
    const closed = once(running.child, 'close')
    running.child.stdin.end(`${version}\nTRANSCRIPT_JSON\n${JSON.stringify({ sessionContext: '', messages: [{ role: 'user', text: 'Checkout failed' }] })}`)
    await waitForPath(join(controlDirectory, 'codex-exec-1.started'))
    writeFileSync(join(controlDirectory, 'codex-exec-1.release'), 'release\n')
    const [code] = await closed
    assert.equal(code, 0, running.output())
    assert.match(running.output(), /Which build and environment did you test/)
    assert.ok(existsSync(join(controlDirectory, 'codex-exec-1.chat.json')))
    assert.doesNotMatch(running.output(), /E2E finding/)
  } finally {
    if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL')
    rmSync(controlDirectory, { recursive: true, force: true })
  }
})

function startFixture(fixture, controlDirectory, args = ['exec', '--json']) {
  let output = ''
  const child = spawn(process.execPath, [fixture, ...args], {
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
