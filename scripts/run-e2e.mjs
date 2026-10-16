#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureBin = join(root, 'e2e', 'fixtures', 'bin')
const criticalSpec = 'critical-workflows.e2e.mjs'
const wdioMaxBuffer = 64 * 1024 * 1024

export const criticalScenarios = Object.freeze([
  'session-lifecycle',
  'manual-testware',
  'clipboard',
  'generation-cancellation',
  'summary-recovery',
])

export function createWdioInvocationPlan(environment, temporaryRoot, artifacts, platform = process.platform) {
  const requestedSpec = environment.QA_SCRIBE_E2E_SPEC?.trim()
  const requestedScenario = environment.QA_SCRIBE_E2E_SCENARIO?.trim()

  if (requestedSpec && requestedSpec !== criticalSpec) {
    if (requestedScenario) throw new Error('QA_SCRIBE_E2E_SCENARIO can only select a critical workflow')
    return [
      {
        id: requestedSpec,
        environment: {
          QA_SCRIBE_E2E_SPEC: requestedSpec,
          ...(/^(model-(management|evidence|selection)|provider-qualification)\.e2e\.mjs$/.test(requestedSpec) ? {
            QA_SCRIBE_E2E_MODEL_EVIDENCE: environment.QA_SCRIBE_E2E_MODEL_EVIDENCE ?? artifacts,
          } : {}),
          ...(['native-close.e2e.mjs', 'model-selection.e2e.mjs'].includes(requestedSpec) ? { GDK_BACKEND: 'x11' } : {}),
          QA_SCRIBE_E2E_APP_DATA_DIR: join(temporaryRoot, 'app-data'),
          QA_SCRIBE_E2E_ARTIFACTS: artifacts,
          QA_SCRIBE_E2E_FIXTURE_DIR: join(temporaryRoot, 'fixtures'),
        },
      },
    ]
  }

  const scenarios = requestedScenario ? [requestedScenario] : criticalScenarios
  for (const scenario of scenarios) {
    if (!criticalScenarios.includes(scenario)) throw new Error(`Unknown critical E2E scenario: ${scenario}`)
  }

  const plan = scenarios.map((scenario) => ({
    id: scenario,
    environment: {
      QA_SCRIBE_E2E_SPEC: criticalSpec,
      QA_SCRIBE_E2E_SCENARIO: scenario,
      QA_SCRIBE_E2E_APP_DATA_DIR: join(temporaryRoot, 'app-data', scenario),
      QA_SCRIBE_E2E_ARTIFACTS: join(artifacts, 'critical-workflows', scenario),
      QA_SCRIBE_E2E_FIXTURE_DIR: join(temporaryRoot, 'fixtures', scenario),
    },
  }))
  if (!requestedSpec && !requestedScenario) {
    for (const id of ['chat-to-note', ...['codex', 'claude', 'copilot'].map((provider) => `chat-tool-authorization-${provider}`), ...(platform === 'linux' ? ['native-close'] : [])]) {
      const provider = id.startsWith('chat-tool-authorization-') ? id.slice('chat-tool-authorization-'.length) : null
      plan.push({ id, environment: {
        QA_SCRIBE_E2E_SPEC: provider ? 'chat-tool-authorization.workflow.mjs' : `${id}.e2e.mjs`,
        ...(provider ? { QA_SCRIBE_E2E_AUTH_PROVIDER: provider } : {}),
        ...(id === 'native-close' ? { GDK_BACKEND: 'x11' } : {}),
        QA_SCRIBE_E2E_APP_DATA_DIR: join(temporaryRoot, 'app-data', id),
        QA_SCRIBE_E2E_ARTIFACTS: join(artifacts, id),
        QA_SCRIBE_E2E_FIXTURE_DIR: join(temporaryRoot, 'fixtures', id),
      } })
    }
    if (platform === 'linux') {
      const modelRuns = [
        ['model-management', 'model-management', null, {}],
        ['model-evidence', 'model-evidence', null, { QA_SCRIBE_E2E_EVIDENCE_RESTART: '0' }],
        ['model-evidence-restart', 'model-evidence', 'model-evidence', { QA_SCRIBE_E2E_EVIDENCE_RESTART: '1' }],
        ['model-selection', 'model-selection', null, { GDK_BACKEND: 'x11', QA_SCRIBE_E2E_SELECTION_RESTART: '0' }],
        ['model-selection-restart', 'model-selection', 'model-selection', { GDK_BACKEND: 'x11', QA_SCRIBE_E2E_SELECTION_RESTART: '1' }],
        ...['disabled', 'diagnostics', 'selector'].map((mode) => [`provider-qualification-${mode}`, 'provider-qualification', null,
          { QA_SCRIBE_E2E_CATALOG_MODE: mode }]),
      ]
      for (const [id, spec, restartOf, extra] of modelRuns) {
        const stateId = restartOf ?? id
        const evidenceRoot = join(artifacts, restartOf ?? id)
        plan.push({ id, ...(restartOf ? { restartOf } : {}), environment: {
          QA_SCRIBE_E2E_SPEC: `${spec}.e2e.mjs`,
          QA_SCRIBE_E2E_APP_DATA_DIR: join(temporaryRoot, 'app-data', stateId),
          QA_SCRIBE_E2E_FIXTURE_DIR: join(temporaryRoot, 'fixtures', stateId),
          QA_SCRIBE_E2E_ARTIFACTS: join(evidenceRoot, restartOf ? 'restart-runner' : 'runner'),
          QA_SCRIBE_E2E_MODEL_EVIDENCE: evidenceRoot,
          ...extra,
        } })
      }
    }
  }
  return plan
}

// Written only by the WDIO Mocha lifecycle hook, never inferred from console output.
export function readExecutionEvidence(path, spec) {
  try {
    const evidence = JSON.parse(readFileSync(path, 'utf8'))
    if (evidence.version !== 1 || evidence.spec !== spec || evidence.completed !== true
      || !Number.isInteger(evidence.passed) || evidence.passed < 1
      || evidence.failed !== 0 || evidence.skipped !== 0) return null
    return evidence
  } catch { return null }
}

export function readModelLaneEvidence(path, phase, restartRequired) {
  try {
    const evidence = JSON.parse(readFileSync(path, 'utf8'))
    if (evidence.phase !== phase || evidence.passed !== 10 || evidence.results?.length !== 10
      || evidence.results.some((lane, index) => lane.lane !== index + 1 || lane.status !== 'passed')) return null
    if (restartRequired && (evidence.completed !== true || evidence.nativeRestartVerified !== true)) return null
    if (phase === 'M01' && evidence.completed !== true) return null
    if (phase !== 'M01' && !restartRequired && (evidence.completed !== false || evidence.nativeRestartVerified !== false)) return null
    return evidence
  } catch { return null }
}

export function readQualificationEvidence(path, mode) {
  try {
    const evidence = JSON.parse(readFileSync(path, 'utf8'))
    const lanes = { disabled: [4], diagnostics: [5], selector: [6, 7, 8] }[mode]
    if (!lanes || evidence.phase !== 'M04' || evidence.mode !== mode || evidence.completed !== true
      || evidence.results?.length !== lanes.length
      || evidence.results.some((result, index) => result.lane !== lanes[index] || result.status !== 'passed')) return null
    return evidence
  } catch { return null }
}

export function executeWdioInvocations(invocations, execute) {
  const results = []
  for (const invocation of invocations) {
    try {
      const completed = execute(invocation)
      results.push({
        id: invocation.id,
        status: completed.status,
        signal: completed.signal ?? null,
        stdout: completed.stdout ?? '',
        stderr: completed.stderr ?? '',
      })
    } catch (error) {
      results.push({
        id: invocation.id,
        status: 1,
        signal: null,
        stdout: '',
        stderr: `${error instanceof Error ? error.message : error}\n`,
      })
    }
  }

  const firstFailure = results.find((result) => result.status !== 0)
  return {
    status: firstFailure ? firstFailure.status ?? 1 : 0,
    signal: firstFailure?.signal ?? null,
    results,
  }
}

export function runE2e(environment = process.env, { spawnSyncImpl = spawnSync } = {}) {
  const artifacts = resolve(environment.QA_SCRIBE_E2E_ARTIFACTS ?? join(root, 'artifacts', 'e2e'))
  const ownsTemporaryRoot = !environment.QA_SCRIBE_E2E_TEMP_ROOT
  const temporaryRoot = resolve(environment.QA_SCRIBE_E2E_TEMP_ROOT ?? mkdtempSync(join(tmpdir(), 'qa-scribe-e2e-')))
  const frontendDist = join(temporaryRoot, 'frontend-dist')
  const skipBuild = environment.QA_SCRIBE_E2E_SKIP_BUILD === '1'
  const startedAt = Date.now()
  let result = { status: 1, signal: null, results: [] }

  if (environment.QA_SCRIBE_E2E_PRESERVE_ARTIFACTS !== '1') rmSync(artifacts, { recursive: true, force: true })
  mkdirSync(artifacts, { recursive: true })
  for (const provider of ['codex', 'claude', 'copilot']) chmodSync(join(fixtureBin, provider), 0o755)

  const tauriConfig = JSON.parse(readFileSync(join(root, 'e2e', 'tauri.e2e.conf.json'), 'utf8'))
  tauriConfig.build.frontendDist = frontendDist
  const isolatedEnvironment = {
    ...environment,
    HOME: join(temporaryRoot, 'home'),
    CODEX_HOME: join(temporaryRoot, 'home', '.codex'),
    CLAUDE_CONFIG_DIR: join(temporaryRoot, 'home', '.claude'),
    COPILOT_HOME: join(temporaryRoot, 'home', '.copilot'),
    XDG_CONFIG_HOME: join(temporaryRoot, 'config'),
    XDG_DATA_HOME: join(temporaryRoot, 'data'),
    XDG_CACHE_HOME: join(temporaryRoot, 'cache'),
    TMPDIR: join(temporaryRoot, 'tmp'),
    // Toolchain caches are build inputs, not application/provider state. Keep
    // them shared so isolation does not redownload Rust for every E2E run.
    CARGO_HOME: environment.CARGO_HOME ?? join(homedir(), '.cargo'),
    RUSTUP_HOME: environment.RUSTUP_HOME ?? join(homedir(), '.rustup'),
    // Fast provider readiness reads PATH directly. Put the fixture first so a
    // clean CI runner and a developer machine with real CLIs behave identically.
    PATH: [fixtureBin, process.env.PATH].filter(Boolean).join(delimiter),
    QA_SCRIBE_E2E_PROVIDER_PATH: fixtureBin,
    QA_SCRIBE_E2E_BINARY: join(root, 'target', 'debug', process.platform === 'win32' ? 'qa-scribe-tauri.exe' : 'qa-scribe-tauri'),
    TAURI_CONFIG: JSON.stringify(tauriConfig),
  }

  for (const directory of ['home', 'config', 'data', 'cache', 'tmp', 'app-data', 'fixtures']) {
    mkdirSync(join(temporaryRoot, directory), { recursive: true })
  }

  function run(command, args, commandEnvironment = isolatedEnvironment) {
    const completed = spawnSyncImpl(command, args, {
      cwd: root,
      env: commandEnvironment,
      stdio: 'inherit',
      shell: false,
    })
    if (completed.status !== 0) {
      throw new Error(`${command} ${args.join(' ')} failed with exit code ${completed.status ?? 'unknown'}`)
    }
    return completed
  }

  try {
    if (!skipBuild) {
      run(
        'bun',
        ['run', '--cwd', 'frontend', 'build', '--', '--outDir', frontendDist, '--emptyOutDir'],
        { ...isolatedEnvironment, VITE_QA_SCRIBE_E2E: '1' },
      )
      run('cargo', ['build', '--package', 'qa-scribe-tauri', '--features', 'e2e'])
    }

    const wdio = join(root, 'frontend', 'node_modules', '.bin', process.platform === 'win32' ? 'wdio.cmd' : 'wdio')
    const invocations = createWdioInvocationPlan(environment, temporaryRoot, artifacts)
    result = executeWdioInvocations(invocations, (invocation) => {
      const invocationEnvironment = { ...isolatedEnvironment, ...invocation.environment }
      const defaultRun = !environment.QA_SCRIBE_E2E_SPEC?.trim() && !environment.QA_SCRIBE_E2E_SCENARIO?.trim()
      if (defaultRun) {
        const stateId = invocation.restartOf ?? invocation.id
        invocationEnvironment.HOME = join(temporaryRoot, 'home', stateId)
        invocationEnvironment.XDG_CONFIG_HOME = join(temporaryRoot, 'config', stateId)
        invocationEnvironment.XDG_DATA_HOME = join(temporaryRoot, 'data', stateId)
        invocationEnvironment.XDG_CACHE_HOME = join(temporaryRoot, 'cache', stateId)
        if (!invocation.environment.QA_SCRIBE_E2E_EVIDENCE_RESTART) delete invocationEnvironment.QA_SCRIBE_E2E_EVIDENCE_RESTART
        if (!invocation.environment.QA_SCRIBE_E2E_SELECTION_RESTART) delete invocationEnvironment.QA_SCRIBE_E2E_SELECTION_RESTART
      }
      invocationEnvironment.CODEX_HOME = join(invocationEnvironment.HOME,
        invocationEnvironment.QA_SCRIBE_E2E_SPEC === 'provider-qualification.e2e.mjs' ? 'codex-override' : '.codex')
      invocationEnvironment.CLAUDE_CONFIG_DIR = join(invocationEnvironment.HOME, '.claude')
      invocationEnvironment.COPILOT_HOME = join(invocationEnvironment.HOME, '.copilot')
      for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'COPILOT_HOME']) {
        mkdirSync(invocationEnvironment[key], { recursive: true })
      }
      if (!invocation.restartOf && (invocation.environment.QA_SCRIBE_E2E_SCENARIO || defaultRun)) {
        rmSync(invocation.environment.QA_SCRIBE_E2E_APP_DATA_DIR, { recursive: true, force: true })
        rmSync(invocation.environment.QA_SCRIBE_E2E_FIXTURE_DIR, { recursive: true, force: true })
      }
      mkdirSync(invocation.environment.QA_SCRIBE_E2E_APP_DATA_DIR, { recursive: true })
      mkdirSync(invocation.environment.QA_SCRIBE_E2E_ARTIFACTS, { recursive: true })
      mkdirSync(invocation.environment.QA_SCRIBE_E2E_FIXTURE_DIR, { recursive: true })
      // Fast readiness checks executable presence. Keep non-Codex fixtures out
      // of the default provider PATH, not merely returning an unavailable version.
      const providerBin = join(invocation.environment.QA_SCRIBE_E2E_FIXTURE_DIR, 'bin')
      mkdirSync(providerBin, { recursive: true })
      const authorization = invocationEnvironment.QA_SCRIBE_E2E_SPEC === 'chat-tool-authorization.workflow.mjs'
      const modelSelection = invocationEnvironment.QA_SCRIBE_E2E_SPEC === 'model-selection.e2e.mjs'
      const modelPickerPerformance = invocationEnvironment.QA_SCRIBE_E2E_SPEC === 'model-picker-performance.e2e.mjs'
      const qualification = invocationEnvironment.QA_SCRIBE_E2E_SPEC === 'provider-qualification.e2e.mjs'
      const modelEvidence = invocationEnvironment.QA_SCRIBE_E2E_SPEC === 'model-evidence.e2e.mjs'
      const modelManagement = modelEvidence || modelSelection || modelPickerPerformance || qualification || invocationEnvironment.QA_SCRIBE_E2E_SPEC === 'model-management.e2e.mjs'
      const sourceBin = qualification ? join(invocation.environment.QA_SCRIBE_E2E_FIXTURE_DIR, 'provider-copy', 'bin') : fixtureBin
      if (qualification) cpSync(join(root, 'e2e', 'fixtures'), join(invocation.environment.QA_SCRIBE_E2E_FIXTURE_DIR, 'provider-copy'), { recursive: true })
      for (const provider of ['codex', 'claude', 'copilot']) rmSync(join(providerBin, provider), { force: true })
      for (const provider of authorization || modelManagement ? ['codex', 'claude', 'copilot'] : ['codex']) {
        const link = join(providerBin, provider)
        symlinkSync(join(sourceBin, provider), link)
      }
      invocationEnvironment.PATH = [providerBin, process.env.PATH].filter(Boolean).join(delimiter)
      invocationEnvironment.QA_SCRIBE_E2E_PROVIDER_PATH = providerBin
      if (!authorization) delete invocationEnvironment.QA_SCRIBE_E2E_AUTH_PROVIDER
      if (modelManagement) {
        invocationEnvironment.QA_SCRIBE_E2E_MODEL_MANAGEMENT = '1'
        invocationEnvironment.QA_SCRIBE_PROVIDER_CATALOG_MODE = qualification
          ? invocationEnvironment.QA_SCRIBE_E2E_CATALOG_MODE ?? 'selector' : 'selector'
        writeFileSync(join(invocation.environment.QA_SCRIBE_E2E_FIXTURE_DIR, 'model-management.json'),
          JSON.stringify(modelSelection && invocationEnvironment.QA_SCRIBE_E2E_SELECTION_RESTART === '1'
            ? { claude: 'unavailable', codex: 'unavailable', copilot: 'unavailable' }
            : { claude: 'fresh', codex: 'fresh', copilot: 'fresh' }))
      }
      if (modelEvidence || modelSelection) {
        const legacyDatabase = join(invocation.environment.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite')
        if (invocationEnvironment.QA_SCRIBE_E2E_EVIDENCE_RESTART !== '1'
          && invocationEnvironment.QA_SCRIBE_E2E_SELECTION_RESTART !== '1') {
          run('python3', [join(root, 'e2e/fixtures/model-evidence-database.py'), 'seed', legacyDatabase,
            join(root, 'crates/qa-scribe-core/tests/fixtures/schema_v10.sql'),
            join(invocation.environment.QA_SCRIBE_E2E_FIXTURE_DIR, 'model-evidence-legacy-seed.json')], invocationEnvironment)
          if (modelSelection) run('python3', [join(root, 'e2e/fixtures/model-selection-legacy.py'), legacyDatabase], invocationEnvironment)
        }
      }
      const evidencePath = join(invocation.environment.QA_SCRIBE_E2E_ARTIFACTS, 'wdio-execution.json')
      rmSync(evidencePath, { force: true })
      invocationEnvironment.QA_SCRIBE_E2E_EXECUTION_EVIDENCE = evidencePath
      const completed = spawnSyncImpl(wdio, ['run', join(root, 'e2e', 'wdio.conf.mjs')], {
        cwd: root,
        env: invocationEnvironment,
        encoding: 'utf8',
        maxBuffer: wdioMaxBuffer,
        shell: process.platform === 'win32',
      })
      const stdout = completed.stdout ?? ''
      const stderr = `${completed.stderr ?? ''}${completed.error ? `${completed.error.message}\n` : ''}`
      process.stdout.write(stdout)
      process.stderr.write(stderr)
      writeFileSync(join(invocation.environment.QA_SCRIBE_E2E_ARTIFACTS, 'wdio-run.log'), `${stdout}${stderr}`)
      const evidence = readExecutionEvidence(evidencePath, invocationEnvironment.QA_SCRIBE_E2E_SPEC)
      const modelPhase = { 'model-management.e2e.mjs': 'M01', 'model-evidence.e2e.mjs': 'M02', 'model-selection.e2e.mjs': 'M03' }[invocationEnvironment.QA_SCRIBE_E2E_SPEC]
      const restartRequired = invocationEnvironment.QA_SCRIBE_E2E_EVIDENCE_RESTART === '1' || invocationEnvironment.QA_SCRIBE_E2E_SELECTION_RESTART === '1'
      const modelEvidenceReceipt = modelPhase ? readModelLaneEvidence(join(invocationEnvironment.QA_SCRIBE_E2E_MODEL_EVIDENCE, 'lane-results.json'), modelPhase, restartRequired) : true
      const qualificationEvidenceReceipt = qualification
        ? readQualificationEvidence(join(invocationEnvironment.QA_SCRIBE_E2E_MODEL_EVIDENCE, 'qualification-results.json'), invocationEnvironment.QA_SCRIBE_PROVIDER_CATALOG_MODE) : true
      const missingCoverage = completed.status === 0 && (!evidence || !modelEvidenceReceipt || !qualificationEvidenceReceipt)
      return { ...completed, status: missingCoverage ? 1 : completed.status, stdout,
        stderr: `${stderr}${missingCoverage ? 'WDIO did not produce complete, unskipped machine execution evidence.\n' : ''}` }
    })

    const aggregateLog = result.results
      .map((invocation) => `===== ${invocation.id} (exit ${invocation.status ?? 'unknown'}) =====\n${invocation.stdout}${invocation.stderr}`)
      .join('\n')
    writeFileSync(join(artifacts, 'wdio-run.log'), aggregateLog)
    for (const failed of result.results.filter((invocation) => invocation.status !== 0)) {
      console.error(`E2E invocation failed: ${failed.id} (exit ${failed.status ?? 'unknown'})`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
  } finally {
    const metadata = {
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      platform: process.platform,
      architecture: process.arch,
      runnerClass: environment.QA_SCRIBE_STARTUP_RUNNER_CLASS || `${process.platform}-${process.arch}`,
      runId: environment.GITHUB_RUN_ID ?? null,
      runAttempt: Number(environment.GITHUB_RUN_ATTEMPT || 1),
      status: result.status === 0 ? 'passed' : 'failed',
      exitCode: result.status,
      signal: result.signal,
      invocations: result.results.map(({ id, status, signal }) => ({ id, status, signal })),
      isolatedDataRemoved: ownsTemporaryRoot,
    }
    writeFileSync(join(artifacts, 'latest-run.json'), `${JSON.stringify(metadata, null, 2)}\n`)
    if (ownsTemporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true })
  }

  return result.status === 0 ? 0 : result.status ?? 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = runE2e()
