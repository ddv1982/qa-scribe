import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { checkTauriDiagnosticPatch } from './check-tauri-diagnostic-patch.mjs'

test('the install guard rejects absent or edited patch content and an unreviewed provider version', t => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-patch-integrity-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(join(directory, 'patches'))
  const manifest = readFileSync('frontend/package.json', 'utf8')
  const patchName = 'patches/@wdio%2Ftauri-service@1.2.0.patch'
  const patch = readFileSync(join('frontend', patchName))
  writeFileSync(join(directory, 'package.json'), manifest)
  assert.throws(() => checkTauriDiagnosticPatch(directory), /ENOENT/)
  writeFileSync(join(directory, patchName), patch)
  checkTauriDiagnosticPatch(directory)
  writeFileSync(join(directory, patchName), Buffer.concat([patch, Buffer.from('\n')]))
  assert.throws(() => checkTauriDiagnosticPatch(directory), /integrity mismatch/)
  writeFileSync(join(directory, patchName), patch)
  const altered = JSON.parse(manifest)
  altered.devDependencies['@wdio/tauri-service'] = '1.4.0'
  writeFileSync(join(directory, 'package.json'), JSON.stringify(altered))
  assert.throws(() => checkTauriDiagnosticPatch(directory), /reviewed 1.2.0 pin/)
})

const childSource = `
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const input = JSON.parse(process.argv[1])
const require = createRequire(import.meta.url)
const Module = require('node:module')
const load = Module._load
let service
try {
  if (input.format === 'cjs') Module._load = function(name, ...args) {
    const actual = load.call(this, name, ...args)
    if (name !== '@wdio/native-utils') return actual
    return { ...actual,
      createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
      formatDiagnosticResults: results => console.log('DIAGNOSTIC_RESULTS ' + JSON.stringify(results)),
    }
  }
  service = input.format === 'esm' ? await import(pathToFileURL(input.module)) : require(input.module)
} finally { Module._load = load }
const caps = [{ browserName: 'tauri', 'tauri:options': { application: process.execPath }, 'wdio:tauriServiceOptions': input.capability }]
const launcher = new service.launcher(input.options, caps, {})
try {
  if (input.broken) {
    await launcher.onPrepare({}, caps)
    throw new Error('Broken embedded startup unexpectedly passed')
  }
  await launcher.onWorkerStart('provider-diagnostic-test', caps)
} catch (error) {
  if (!input.broken || !/exited before.*ready.*code=23/s.test(String(error))) throw error
  console.log('EXPECTED_EMBEDDED_FAILURE ' + JSON.stringify({ message: String(error) }))
} finally { await launcher.onComplete() }
process.exit(0)
`

function probe(format, name, options, capability = {}, broken = false) {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-driver-diagnostic-'))
  const calls = join(directory, 'probes.jsonl')
  const commandProbe = `#!${process.execPath}
require('node:fs').appendFileSync(process.env.PROBE_CALLS, JSON.stringify({ command: require('node:path').basename(process.argv[1]), args: process.argv.slice(2) }) + '\\n')
process.exit(1)
`
  try {
    writeFileSync(join(directory, 'package.json'), '{"type":"commonjs"}\n')
    for (const command of ['which', 'cargo']) writeFileSync(join(directory, command), commandProbe, { mode: 0o755 })
    const module = resolve(process.env.QA_SCRIBE_DIAGNOSTIC_MODULE_ROOT ?? 'frontend/node_modules/@wdio/tauri-service', `dist/${format}/index.js`)
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', childSource, JSON.stringify({ format, module, options, capability, broken })], {
      encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, HOME: directory, USERPROFILE: directory, DEBUG: 'wdio-diagnostics', FORCE_COLOR: '0',
        PATH: `${directory}:${process.env.PATH}`, PROBE_CALLS: calls },
    })
    const output = result.stdout + result.stderr
    const requests = (() => { try { return readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) } catch (error) { if (error.code === 'ENOENT') return []; throw error } })()
    if (process.env.QA_SCRIBE_DIAGNOSTIC_EVIDENCE) writeFileSync(join(process.env.QA_SCRIBE_DIAGNOSTIC_EVIDENCE, `${format}-${name}.json`), `${JSON.stringify({ status: result.status, signal: result.signal, error: String(result.error ?? ''), output, requests }, null, 2)}\n`)
    assert.ifError(result.error)
    assert.equal(result.status, 0, output)
    const structured = output.split('\n').find(line => line.startsWith('DIAGNOSTIC_RESULTS '))
    const check = structured ? JSON.parse(structured.slice('DIAGNOSTIC_RESULTS '.length)).find(row => row.category === 'Tauri Driver')
      : (() => { let line = output.split('\n').find(line => line.includes('Tauri Driver:'))
        if (line?.trimStart().startsWith("'") && line.endsWith("'")) line = line.slice(0, -1)
        return line && {
        status: line.includes('✅') ? 'ok' : 'error', message: line.split('Tauri Driver: ')[1],
      } })()
    return { output, requests, check }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

for (const format of ['esm', 'cjs']) {
  for (const [name, options, capability] of [
    ['explicit-embedded', { driverProvider: 'embedded' }, {}],
    ['default-embedded', {}, {}],
    ['capability-embedded', { driverProvider: 'external', tauriDriverPath: '/unused-driver' }, { driverProvider: 'embedded' }],
  ]) {
    test(`${format}: ${name} reports embedded OK without probing or installing an external driver`, () => {
      const { check, requests } = probe(format, name, options, capability)
      assert.equal(check?.status, 'ok')
      assert.match(check.message, /Embedded WebDriver server/)
      assert.ok(!requests.some(call => call.command === 'cargo' || call.args.includes('tauri-driver')), JSON.stringify(requests))
    })
  }
  for (const [name, options, capability] of [
    ['external-missing', { driverProvider: 'external', tauriDriverPath: '/missing-diagnostic-driver' }, {}],
    ['capability-external-missing', { driverProvider: 'embedded' }, { driverProvider: 'external', tauriDriverPath: '/missing-diagnostic-driver' }],
  ]) {
    test(`${format}: ${name} retains the required driver error and configured path`, () => {
      const { check } = probe(format, name, options, capability)
      assert.equal(check?.status, 'error')
      assert.equal(check.message, 'tauri-driver not found at provided path: /missing-diagnostic-driver')
    })
  }
  for (const [name, options, capability] of [
    ['external-custom-path', { driverProvider: 'external', tauriDriverPath: process.execPath }, {}],
    ['capability-crabnebula-path', { driverProvider: 'external' }, { driverProvider: 'crabnebula', crabnebulaDriverPath: process.execPath }],
  ]) {
    test(`${format}: ${name} forwards the actual provider and existing configured executable path`, () => {
      const { check } = probe(format, name, options, capability)
      assert.equal(check?.status, 'ok')
      assert.equal(check.message, `${process.execPath} (found)`)
    })
  }
  test(`${format}: a real embedded child exiting before readiness still rejects startup`, () => {
    const { output, requests } = probe(format, 'broken-embedded', {
      driverProvider: 'embedded', appBinaryPath: process.execPath, appArgs: ['-e', 'process.exit(23)'],
    }, {}, true)
    assert.match(output, /EXPECTED_EMBEDDED_FAILURE.*exited before.*ready.*code=23/s)
    assert.ok(!requests.some(call => call.command === 'cargo' || call.args.includes('tauri-driver')))
  })
}
