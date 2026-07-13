#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(process.env.QA_SCRIBE_E2E_ARTIFACTS ?? join(root, 'artifacts', 'e2e'))
const fixtureBin = join(root, 'e2e', 'fixtures', 'bin')
const ownsTemporaryRoot = !process.env.QA_SCRIBE_E2E_TEMP_ROOT
const temporaryRoot = resolve(process.env.QA_SCRIBE_E2E_TEMP_ROOT ?? mkdtempSync(join(tmpdir(), 'qa-scribe-e2e-')))
const skipBuild = process.env.QA_SCRIBE_E2E_SKIP_BUILD === '1'
const startedAt = Date.now()
let result = { status: 1, signal: null }
let productionFrontendRestored = skipBuild

if (process.env.QA_SCRIBE_E2E_PRESERVE_ARTIFACTS !== '1') rmSync(artifacts, { recursive: true, force: true })
mkdirSync(artifacts, { recursive: true })
chmodSync(join(fixtureBin, 'codex'), 0o755)

const isolatedEnvironment = {
  ...process.env,
  HOME: join(temporaryRoot, 'home'),
  XDG_CONFIG_HOME: join(temporaryRoot, 'config'),
  XDG_DATA_HOME: join(temporaryRoot, 'data'),
  XDG_CACHE_HOME: join(temporaryRoot, 'cache'),
  TMPDIR: join(temporaryRoot, 'tmp'),
  // Toolchain caches are build inputs, not application/provider state. Keep
  // them shared so isolation does not redownload Rust for every E2E run.
  CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
  RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
  // Fast provider readiness reads PATH directly. Put the fixture first so a
  // clean CI runner and a developer machine with real CLIs behave identically.
  PATH: [fixtureBin, process.env.PATH].filter(Boolean).join(delimiter),
  QA_SCRIBE_E2E_PROVIDER_PATH: fixtureBin,
  QA_SCRIBE_E2E_ARTIFACTS: artifacts,
  QA_SCRIBE_E2E_APP_DATA_DIR: join(temporaryRoot, 'app-data'),
  QA_SCRIBE_E2E_BINARY: join(root, 'target', 'debug', process.platform === 'win32' ? 'qa-scribe-tauri.exe' : 'qa-scribe-tauri'),
  TAURI_CONFIG: JSON.stringify(JSON.parse(readFileSync(join(root, 'e2e', 'tauri.e2e.conf.json'), 'utf8'))),
}

for (const directory of ['home', 'config', 'data', 'cache', 'tmp', 'app-data']) {
  mkdirSync(join(temporaryRoot, directory), { recursive: true })
}

function run(command, args, environment = isolatedEnvironment) {
  const completed = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    shell: false,
  })
  if (completed.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${completed.status ?? 'unknown'}`)
  }
  return completed
}

function restoreProductionFrontend() {
  const productionEnvironment = { ...process.env }
  delete productionEnvironment.VITE_QA_SCRIBE_E2E
  run('bun', ['run', '--cwd', 'frontend', 'build'], productionEnvironment)
  productionFrontendRestored = true
}

try {
  if (!skipBuild) {
    run('bun', ['run', '--cwd', 'frontend', 'build'], { ...isolatedEnvironment, VITE_QA_SCRIBE_E2E: '1' })
    run('cargo', ['build', '--package', 'qa-scribe-tauri', '--features', 'e2e'])
    restoreProductionFrontend()
  }

  const wdio = join(root, 'frontend', 'node_modules', '.bin', process.platform === 'win32' ? 'wdio.cmd' : 'wdio')
  result = spawnSync(wdio, ['run', join(root, 'e2e', 'wdio.conf.mjs')], {
    cwd: root,
    env: isolatedEnvironment,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  writeFileSync(join(artifacts, 'wdio-run.log'), `${result.stdout ?? ''}${result.stderr ?? ''}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
} finally {
  if (!productionFrontendRestored) {
    try {
      restoreProductionFrontend()
    } catch (error) {
      console.error(`Failed to restore the production frontend: ${error instanceof Error ? error.message : error}`)
    }
  }

  const metadata = {
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    platform: process.platform,
    architecture: process.arch,
    runnerClass: process.env.QA_SCRIBE_STARTUP_RUNNER_CLASS || `${process.platform}-${process.arch}`,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1),
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    isolatedDataRemoved: ownsTemporaryRoot,
  }
  writeFileSync(join(artifacts, 'latest-run.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  if (ownsTemporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true })
}

process.exitCode = result.status === 0 ? 0 : result.status ?? 1
