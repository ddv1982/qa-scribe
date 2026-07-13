#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertStartupBudgets, firstPaintDuration, parseOptionalBudget } from './startup-benchmark-budget.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(root, 'artifacts', 'startup')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'qa-scribe-startup-'))
const appData = join(temporaryRoot, 'app-data')
const database = join(appData, 'qa-scribe.sqlite')
const sampleCount = readSampleCount(process.argv.slice(2))
const legacyBudget = process.env.QA_SCRIBE_STARTUP_BUDGET_MS
const coldBudgetMs = parseOptionalBudget(
  process.env.QA_SCRIBE_STARTUP_COLD_BUDGET_MS ?? legacyBudget,
  'QA_SCRIBE_STARTUP_COLD_BUDGET_MS',
)
const warmBudgetMs = parseOptionalBudget(
  process.env.QA_SCRIBE_STARTUP_WARM_BUDGET_MS ?? legacyBudget,
  'QA_SCRIBE_STARTUP_WARM_BUDGET_MS',
)
const runnerClass = process.env.QA_SCRIBE_STARTUP_RUNNER_CLASS || `${process.platform}-${process.arch}-local`
const reuseBuild = process.env.QA_SCRIBE_STARTUP_REUSE_BUILD === '1'
const startedAt = Date.now()
const samples = []

rmSync(artifacts, { recursive: true, force: true })
mkdirSync(appData, { recursive: true })
mkdirSync(artifacts, { recursive: true })

function run(command, args, environment = process.env) {
  const completed = spawnSync(command, args, { cwd: root, env: environment, stdio: 'inherit', shell: false })
  if (completed.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${completed.status ?? 'unknown'}`)
}

try {
  run('cargo', ['run', '--quiet', '-p', 'qa-scribe-core', '--example', 'generate_startup_fixture', '--', database])

  for (let index = 0; index < sampleCount; index += 1) {
    const runKind = index === 0 ? 'cold-process' : 'warm-process'
    const sampleBudgetMs = index === 0 ? coldBudgetMs : warmBudgetMs
    const runArtifacts = join(artifacts, `${index + 1}-${runKind}`)
    const samplePath = join(runArtifacts, 'startup-sample.json')
    run('node', ['scripts/run-e2e.mjs'], {
      ...process.env,
      QA_SCRIBE_E2E_TEMP_ROOT: temporaryRoot,
      QA_SCRIBE_E2E_ARTIFACTS: runArtifacts,
      QA_SCRIBE_E2E_SPEC: 'startup-performance.benchmark.mjs',
      QA_SCRIBE_E2E_SKIP_BUILD: reuseBuild || index > 0 ? '1' : '0',
      QA_SCRIBE_STARTUP_SAMPLE: samplePath,
      QA_SCRIBE_STARTUP_RUN_KIND: runKind,
      QA_SCRIBE_STARTUP_RUNNER_CLASS: runnerClass,
      QA_SCRIBE_STARTUP_BUDGET_MS: sampleBudgetMs ? String(sampleBudgetMs) : '',
    })
    samples.push(JSON.parse(readFileSync(samplePath, 'utf8')))
  }

  const report = {
    schema: 'qa-scribe-startup-report-v1',
    capturedAt: new Date().toISOString(),
    runnerClass,
    fixture: {
      sessions: 1_000,
      entries: 1_000,
      activeDrafts: 250,
      activeFindings: 250,
      aiRuns: 2_000,
    },
    budgetMs: coldBudgetMs === warmBudgetMs ? coldBudgetMs : null,
    budgets: {
      coldFirstPaintMs: coldBudgetMs,
      warmFirstPaintMs: warmBudgetMs,
    },
    durationMs: Date.now() - startedAt,
    samples,
    summary: summarize(samples),
    productionBundle: bundleSummary(join(root, 'frontend', 'dist', 'assets')),
  }
  writeFileSync(join(artifacts, 'startup-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Startup benchmark: cold=${report.summary.coldFirstPaintMs.toFixed(1)}ms warm_p50=${report.summary.warmFirstPaintP50Ms.toFixed(1)}ms`)
  assertStartupBudgets(report)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}

function readSampleCount(argv) {
  const index = argv.indexOf('--samples')
  const value = Number(index >= 0 ? argv[index + 1] : process.env.QA_SCRIBE_STARTUP_SAMPLES || 5)
  if (!Number.isInteger(value) || value < 2 || value > 20) throw new Error('--samples must be an integer between 2 and 20')
  return value
}

function percentile(values, percentileValue) {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.ceil((percentileValue / 100) * ordered.length) - 1)]
}

function summarize(allSamples) {
  const cold = firstPaintDuration(allSamples[0])
  const warm = allSamples.slice(1).map(firstPaintDuration)
  return {
    coldFirstPaintMs: cold,
    warmFirstPaintP50Ms: percentile(warm, 50),
    warmFirstPaintP95Ms: percentile(warm, 95),
    editorInputP50Ms: percentile(allSamples.map((sample) => sample.editorInputMs), 50),
    editorInputP95Ms: percentile(allSamples.map((sample) => sample.editorInputMs), 95),
    maxVisibleSessions: Math.max(...allSamples.map((sample) => sample.visibleSessionCount)),
  }
}

function bundleSummary(directory) {
  const chunks = readdirSync(directory)
    .filter((name) => name.endsWith('.js'))
    .map((name) => {
      const contents = readFileSync(join(directory, name))
      return { name, bytes: statSync(join(directory, name)).size, gzipBytes: gzipSync(contents).length }
    })
    .sort((left, right) => right.bytes - left.bytes)
  return {
    javascriptBytes: chunks.reduce((total, chunk) => total + chunk.bytes, 0),
    javascriptGzipBytes: chunks.reduce((total, chunk) => total + chunk.gzipBytes, 0),
    chunks,
  }
}
