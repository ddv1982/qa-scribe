import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { runStartupBenchmark } from './run-startup-benchmark.mjs'
import { qualitySummary } from './write-quality-summary.mjs'

const sample = (durationMs) => ({ measures: [{ name: 'qa-scribe startup boot-to-first-paint-after-boot', durationMs }],
  editorInputMs: 12, visibleSessionCount: 20 })

for (const mode of ['exit', 'spawn-error', 'timeout']) {
  test(`startup preserves earlier samples and its ${mode} receipt before throwing`, () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-scribe-startup-test-'))
    const reportPath = join(root, 'artifacts/startup/startup-report.json')
    const pidPath = join(root, 'pid')
    let launch = 0
    let ownedRoot
    try {
      mkdirSync(join(root, 'frontend/dist/assets'), { recursive: true })
      assert.throws(() => runStartupBenchmark({ QA_SCRIBE_STARTUP_REUSE_BUILD: '1', QA_SCRIBE_STARTUP_SAMPLES: '3' }, {
        root, argv: [],
        spawnSyncImpl(command, args, options) {
          const running = JSON.parse(readFileSync(reportPath, 'utf8'))
          assert.equal(running.commands.at(-1).status, 'running')
          assert.equal(options.killSignal, 'SIGKILL')
          if (command === 'cargo') return { status: 0 }
          ownedRoot = options.env.QA_SCRIBE_E2E_TEMP_ROOT
          assert.equal(options.timeout, 240_000)
          launch++
          if (launch === 1) {
            mkdirSync(dirname(options.env.QA_SCRIBE_STARTUP_SAMPLE), { recursive: true })
            writeFileSync(options.env.QA_SCRIBE_STARTUP_SAMPLE, JSON.stringify(sample(210)))
            return { status: 0 }
          }
          assert.equal(running.samples.length, 1)
          if (mode === 'exit') {
            mkdirSync(dirname(options.env.QA_SCRIBE_STARTUP_SAMPLE), { recursive: true })
            writeFileSync(options.env.QA_SCRIBE_STARTUP_SAMPLE, JSON.stringify(sample(310)))
            return { status: 19 }
          }
          return mode === 'spawn-error' ? spawnSync(join(root, 'missing'), [], options)
            : spawnSync(process.execPath, ['-e', `require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)`, pidPath], { ...options, timeout: 250 })
        },
      }), mode === 'exit' ? { exitCode: 19 } : { exitCode: 1 })
      const report = JSON.parse(readFileSync(reportPath, 'utf8'))
      assert.equal(report.status, 'failed')
      assert.deepEqual(report.samples, mode === 'exit' ? [sample(210), sample(310)] : [sample(210)])
      assert.deepEqual(report.commands.map(({ status }) => status), ['passed', 'passed', 'failed'])
      assert.equal(report.firstFailure.stage, 'sample-2-warm-process')
      assert.equal(report.firstFailure.spawnError?.code ?? null, { exit: null, 'spawn-error': 'ENOENT', timeout: 'ETIMEDOUT' }[mode])
      assert.equal(report.isolatedDataRemoved, true)
      assert.equal(existsSync(ownedRoot), false)
      assert.equal(launch, 2)
      const summary = qualitySummary(root, {})
      assert.match(summary, /Status: failed/)
      assert.match(summary, /Samples retained: [12] \/ 3/)
      assert.match(summary, /First failure: sample-2-warm-process/)
      assert.doesNotMatch(summary, /Cold first paint:/)
      if (mode === 'timeout') assert.throws(() => process.kill(Number(readFileSync(pidPath)), 0), { code: 'ESRCH' })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test('startup writes the complete report before enforcing unchanged cold and warm budgets', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-startup-budget-'))
  try {
    mkdirSync(join(root, 'frontend/dist/assets'), { recursive: true })
    writeFileSync(join(root, 'frontend/dist/assets/main.js'), 'export const fixture = true')
    let count = 0
    assert.throws(() => runStartupBenchmark({ QA_SCRIBE_STARTUP_REUSE_BUILD: '1', QA_SCRIBE_STARTUP_SAMPLES: '2',
      QA_SCRIBE_STARTUP_COLD_BUDGET_MS: '4000', QA_SCRIBE_STARTUP_WARM_BUDGET_MS: '3000' }, {
      root, argv: [], spawnSyncImpl(command, _args, options) {
        if (command === 'cargo') return { status: 0 }
        mkdirSync(dirname(options.env.QA_SCRIBE_STARTUP_SAMPLE), { recursive: true })
        writeFileSync(options.env.QA_SCRIBE_STARTUP_SAMPLE, JSON.stringify(sample(count++ === 0 ? 4100 : 3100)))
        return { status: 0 }
      },
    }), /cold first paint 4100.0ms exceeded 4000ms; warm sample 1 first paint 3100.0ms exceeded 3000ms/)
    const report = JSON.parse(readFileSync(join(root, 'artifacts/startup/startup-report.json')))
    assert.equal(report.status, 'failed')
    assert.equal(report.samples.length, 2)
    assert.equal(report.summary.coldFirstPaintMs, 4100)
    assert.equal(report.firstFailure.stage, 'startup-report')
    assert.match(qualitySummary(root, {}), /Cold first paint: 4100.0ms/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('startup retains an empty partial report on fixture spawn error', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-startup-no-fixture-'))
  try {
    assert.throws(() => runStartupBenchmark({}, { root, argv: [], spawnSyncImpl(_command, _args, options) {
      return spawnSync(join(root, 'missing-fixture-command'), [], options)
    } }), /spawn error ENOENT/)
    const report = JSON.parse(readFileSync(join(root, 'artifacts/startup/startup-report.json')))
    assert.deepEqual(report.samples, [])
    assert.equal(report.firstFailure.stage, 'fixture')
    assert.equal(report.firstFailure.spawnError.code, 'ENOENT')
    assert.equal(report.status, 'failed')
    assert.match(qualitySummary(root, {}), /Samples retained: 0 \/ 5/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
