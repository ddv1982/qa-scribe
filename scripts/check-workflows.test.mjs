import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { checkWorkflows, normalizeWorkflowSource, readWorkflowToolVersions } from './check-workflows.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { parse } = require('yaml')
const picomatch = createRequire(require.resolve('vite/package.json'))('picomatch')
const fixture = `name: Self-reference regression
on: push
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: $/.github/actions/setup-project
        with:
          cache-key: workflow-check-fixture
`
const lint = source => spawnSync('actionlint', ['-stdin-filename', '.github/workflows/ci.yml', '-'], {
  cwd: root, input: source, encoding: 'utf8',
})

test('real pinned actionlint rejects original $/ fixture, accepts stdin adapter, and retains validation', () => {
  const version = spawnSync('actionlint', ['--version'], { cwd: root, encoding: 'utf8' })
  assert.ifError(version.error)
  assert.equal(version.status, 0, version.stderr)
  assert.equal(version.stdout.split(/\r?\n/)[0], '1.7.12')
  const original = lint(fixture)
  assert.ifError(original.error)
  assert.equal(original.status, 1, original.stdout + original.stderr)
  assert.match(original.stdout + original.stderr, /uses/)
  console.log(`Original actionlint rejection (unmodified $/ fixture):\n${original.stdout}${original.stderr}`)
  const normalized = lint(normalizeWorkflowSource(fixture))
  assert.ifError(normalized.error)
  assert.equal(normalized.status, 0, normalized.stdout + normalized.stderr)
  for (const [source, reason] of [
    [fixture.replace('    runs-on:', '    needs: nonexistent-job\n    runs-on:'), /nonexistent-job/],
    [fixture.replace('      - uses:', '      - run: echo invalid\n        uses:'), /run|uses/],
  ]) {
    const invalid = lint(normalizeWorkflowSource(source))
    assert.ifError(invalid.error)
    assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr)
    assert.match(invalid.stdout + invalid.stderr, reason)
  }
})

test('real pinned actionlint accepts the Ubuntu 26.04 hosted label and still rejects typos', () => {
  for (const [label, status] of [['ubuntu-26.04', 0], ['ubuntu-26.40', 1]]) {
    const result = lint(normalizeWorkflowSource(fixture.replace('ubuntu-24.04', label)))
    assert.ifError(result.error)
    assert.equal(result.status, status, result.stdout + result.stderr)
    if (status !== 0) assert.match(result.stdout + result.stderr, /runner-label/)
  }
})

test('only actual job and step references change, preserving quotes, Unicode, bytes and line offsets', () => {
  const source = `# 🧪 café uses: $/comment\r
name: 'uses: $/metadata'\r
env: {uses: $/environment}\r
jobs:\r
  reusable:\r
    uses: '$/.github/workflows/reusable.yml' # uses: $/comment\r
  check:\r
    runs-on: ubuntu-latest\r
    env: {uses: $/job-environment}\r
    steps:\r
      - uses: $/.github/actions/setup-project\r
        with: {uses: $/input}\r
      - uses: "$/.github/actions/other"\r
      - run: |\r
          uses: $/shell-text\r
        env: {uses: $/step-environment}\r
`
  const expected = source
    .replace("uses: '$/.github/workflows/", "uses: './.github/workflows/")
    .replace('uses: $/.github/actions/', 'uses: ./.github/actions/')
    .replace('uses: "$/.github/actions/', 'uses: "./.github/actions/')
  const result = normalizeWorkflowSource(source)
  assert.equal(result, expected)
  assert.equal(result.length, source.length)
  assert.equal(Buffer.byteLength(result), Buffer.byteLength(source))
  const differences = [...Array(source.length).keys()].filter(index => source[index] !== result[index])
  assert.equal(differences.length, 3)
  for (const index of differences) {
    assert.equal(source[index], '$')
    assert.equal(result[index], '.')
  }
  assert.deepEqual([...result.matchAll(/\r?\n/g)].map(match => match.index), [...source.matchAll(/\r?\n/g)].map(match => match.index))
  assert.equal(normalizeWorkflowSource(result), result)
})

test('parser rejects malformed and duplicate YAML and unsafe self-reference representations', () => {
  const values = [
    '"\\u0024/.github/actions/setup-project"',
    '"$/\\u002egithub/actions/setup-project"',
    '!!str $/.github/actions/setup-project',
    '>\n          $/.github/actions/setup-project',
    '|-\n          $/.github/actions/setup-project',
    '&reference $/.github/actions/setup-project',
    '*reference',
  ]
  for (const value of values) {
    assert.throws(() => normalizeWorkflowSource(fixture.replace('$/.github/actions/setup-project', value)), /Unsupported|Invalid workflow YAML/)
  }
  assert.throws(() => normalizeWorkflowSource('jobs: [unterminated'), /Invalid workflow YAML/)
  assert.throws(() => normalizeWorkflowSource(fixture.replace('    runs-on:', '    runs-on: duplicate\n    runs-on:')), /Invalid workflow YAML/)
  assert.throws(() => normalizeWorkflowSource('jobs: {}\njobs: {}\n'), /Invalid workflow YAML/)
  assert.throws(() => normalizeWorkflowSource('jobs: {check: {<<: {uses: $/hidden}}}'), /merge key/)
  assert.throws(() => normalizeWorkflowSource('env: {x: &unused value}\njobs: {}'), /anchor/)
})

test('malformed job and steps paths fail closed instead of being skipped', () => {
  for (const source of [
    '[]', 'jobs: null', 'jobs: []', 'jobs: {check: null}',
    'jobs: {check: {steps: null}}', 'jobs: {check: {steps: {uses: $/hidden}}}',
    'jobs: {check: {steps: [null]}}', 'jobs: {check: {uses: [$/hidden]}}',
  ]) assert.throws(() => normalizeWorkflowSource(source), /Expected mapping|Expected sequence|Expected scalar/)
})

test('tool pins require stable exact versions and preserve existing tool pins', () => {
  assert.deepEqual(readWorkflowToolVersions(), { actionlint: '1.7.12', zizmor: '1.30.1' })
  const data = JSON.parse(readFileSync(new URL('./tool-versions.json', import.meta.url), 'utf8'))
  assert.equal(data.tauriCli, '2.11.4')
  assert.equal(data.cargoAudit, '0.22.2')
  for (const name of ['actionlint', 'zizmor']) {
    for (const value of [undefined, null, 1, '^1.7.12', '1.7.12-beta.1', '01.7.12', '1.7']) {
      assert.throws(() => readWorkflowToolVersions({ ...data, [name]: value }), /stable .* version pin/)
    }
  }
})

test('checker discovers every workflow in sorted order and preserves process status and invocation', () => {
  const files = readdirSync(resolve(root, '.github/workflows'), { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.ya?ml$/.test(entry.name)).map(entry => entry.name).sort()
  const calls = []
  const status = checkWorkflows(root, (command, args, options) => {
    calls.push({ command, args, options })
    return args[0] === '--version' ? { status: 0, stdout: '1.7.12\n', stderr: '' } : { status: 7 }
  })
  assert.equal(status, 7)
  assert.deepEqual(calls[0], { command: 'actionlint', args: ['--version'], options: { cwd: root, encoding: 'utf8' } })
  assert.deepEqual(calls.slice(1), files.map(file => ({
    command: 'actionlint', args: ['-stdin-filename', `.github/workflows/${file}`, '-'],
    options: { cwd: root, encoding: 'utf8', input: normalizeWorkflowSource(readFileSync(resolve(root, '.github/workflows', file), 'utf8')) },
  })))
})

test('checker fails on wrong version, process error, version failure, and signal termination', () => {
  assert.throws(() => checkWorkflows(root, () => ({ status: 0, stdout: '1.7.11\n' })), /Expected actionlint 1.7.12/)
  assert.throws(() => checkWorkflows(root, () => ({ status: 9 })), /status 9/)
  const failure = new Error('ENOENT actionlint')
  assert.throws(() => checkWorkflows(root, () => ({ error: failure, status: null })), /ENOENT actionlint/)
  for (const result of [{ error: failure, status: null }, { status: null, signal: 'SIGTERM' }]) {
    assert.throws(() => checkWorkflows(root, (_, args) => args[0] === '--version'
      ? { status: 0, stdout: '1.7.12\n' } : result), /ENOENT actionlint|SIGTERM/)
  }
})

test('CLI outputs only install pins without actionlint and rejects unexpected arguments', () => {
  const script = fileURLToPath(new URL('./check-workflows.mjs', import.meta.url))
  const pins = spawnSync(process.execPath, [script, '--github-output'], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '' } })
  assert.ifError(pins.error)
  assert.equal(pins.status, 0, pins.stderr)
  assert.equal(pins.stdout, 'actionlint=1.7.12\nzizmor=1.30.1\n')
  assert.equal(pins.stderr, '')
  const invalid = spawnSync(process.execPath, [script, '--unknown'], { cwd: root, encoding: 'utf8' })
  assert.ifError(invalid.error)
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /Usage:/)
  const missing = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '' } })
  assert.ifError(missing.error)
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /ENOENT/)
})

test('changed paths select the applicable CI and native tooling jobs from workflow YAML', async t => {
  const ci = parse(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'))
  const native = parse(readFileSync(resolve(root, '.github/workflows/native-tooling-validation.yml'), 'utf8'))
  const filters = parse(ci.jobs.changes.steps.find(step => step.id === 'filter').with.filters)
  for (const output of Object.keys(filters)) {
    assert.equal(ci.jobs.changes.outputs[output], '${{ steps.filter.outputs.' + output + ' }}')
  }
  assert.deepEqual(native.on.pull_request.branches, ['main'])
  assert.equal(native.jobs['native-tooling'].if, undefined)
  assert.equal(native.jobs['native-tooling']['continue-on-error'], undefined)
  const cases = [
    ['rust-toolchain.toml', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success']],
    ['scripts/normalize-ci-rust-toolchains.sh', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success']],
    ['scripts/prepare-rust-typescript-sdk.mjs', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['scripts/rust-typescript-sdk.mjs', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['.github/actions/setup-project/action.yml', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['frontend/vite.config.ts', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['frontend/src/main.tsx', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success']],
    ['frontend/.oxlintrc.json', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['frontend/tsconfig.node.json', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['frontend/scripts/check-contrast.mjs', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['scripts/package-tauri-linux.mjs', ['changes', 'quality-linux', 'e2e-macos', 'package-linux', 'ci-success']],
    ['scripts/check-native-tooling-installations.mjs', ['changes', 'quality-linux', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['scripts/check-e2e-isolation.mjs', ['changes', 'quality-linux', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['scripts/run-e2e.mjs', ['changes', 'quality-linux', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['scripts/check-release-metadata.mjs', ['changes', 'quality-linux', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['scripts/command-utils.mjs', ['changes', 'quality-linux', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['scripts/release-constants.json', ['changes', 'quality-linux', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['package.json', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success', 'native-tooling']],
    ['crates/qa-scribe-core/src/lib.rs', ['changes', 'quality-linux', 'rust-macos', 'e2e-macos', 'package-linux', 'ci-success']],
    ['docs/ci.md', ['changes', 'quality-linux', 'e2e-macos', 'ci-success']],
  ]
  for (const [path, expected] of cases) {
    await t.test(path, () => {
      const applicable = Object.entries(ci.jobs).filter(([id, job]) => {
        if (!job.if || id === 'ci-success') return true
        const output = job.if.match(/needs\.changes\.outputs\.(\w+) == 'true'/)?.[1]
        assert.ok(output, `Unsupported routing condition for ${id}: ${job.if}`)
        return picomatch(filters[output], { dot: true })(path)
      }).map(([id]) => id)
      if (picomatch(native.on.pull_request.paths, { dot: true })(path)) applicable.push(...Object.keys(native.jobs))
      assert.deepEqual(applicable, expected)
    })
  }
})

test('quality and release validation retain the full frontend behavior suite', () => {
  const shared = parse(readFileSync(resolve(root, '.github/actions/validate-build/action.yml'), 'utf8'))
  const tests = shared.runs.steps.filter(step => step.run === 'bun run frontend:test')
  assert.equal(tests.length, 1)
  assert.equal(tests[0].if, undefined)
  assert.equal(tests[0]['continue-on-error'], undefined)
  for (const [path, jobId] of [
    ['.github/workflows/ci.yml', 'quality-linux'],
    ['.github/workflows/release.yml', 'validate-release'],
  ]) {
    const { jobs } = parse(readFileSync(resolve(root, path), 'utf8'))
    const validation = jobs[jobId].steps.filter(step => step.uses === '$/.github/actions/validate-build')
    assert.equal(validation.length, 1, `${path} must invoke the shared full gate`)
    assert.equal(validation[0].if, undefined)
    assert.equal(validation[0]['continue-on-error'], undefined)
    assert.equal(jobs[jobId]['continue-on-error'], undefined)
  }
})

test('Linux quality stays unconditional, macOS E2E observational, and CI success propagates failures', () => {
  const { jobs, on } = parse(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'))
  assert.deepEqual(on, { push: { branches: ['main'] }, pull_request: { branches: ['main'] }, merge_group: { types: ['checks_requested'] } })
  assert.equal(jobs['quality-linux'].if, undefined)
  assert.equal(jobs['quality-linux'].needs, undefined)
  for (const id of ['quality-linux', 'rust-macos', 'package-linux', 'ci-success']) {
    assert.equal(jobs[id]['continue-on-error'], undefined)
  }
  assert.equal(jobs['e2e-macos'].if, undefined)
  assert.equal(jobs['e2e-macos']['continue-on-error'], true)
  assert.equal(jobs['rust-macos'].if, "needs.changes.outputs.run_macos_ci == 'true'")
  assert.deepEqual(jobs['package-linux'].needs, ['changes', 'quality-linux'])
  assert.equal(jobs['package-linux'].if, "!cancelled() && needs.changes.outputs.run_package_ci == 'true' && needs.quality-linux.result == 'success'")
  const success = jobs['ci-success']
  assert.equal(success.name, 'CI success')
  assert.equal(success.if, '${{ !cancelled() }}')
  assert.deepEqual(success.needs, ['changes', 'quality-linux', 'rust-macos', 'package-linux'])
  const gate = success.steps[0]
  assert.deepEqual(gate.env, {
    CHANGES_RESULT: '${{ needs.changes.result }}',
    QUALITY_RESULT: '${{ needs.quality-linux.result }}',
    MACOS_RESULT: '${{ needs.rust-macos.result }}',
    PACKAGE_RESULT: '${{ needs.package-linux.result }}',
  })
  const passed = { CHANGES_RESULT: 'success', QUALITY_RESULT: 'success', MACOS_RESULT: 'success', PACKAGE_RESULT: 'success' }
  for (const [results, expected] of [
    [passed, 0],
    [{ ...passed, MACOS_RESULT: 'skipped', PACKAGE_RESULT: 'skipped' }, 0],
    ...Object.keys(passed).flatMap(key => ['failure', 'cancelled'].map(result => [{ ...passed, [key]: result }, 1])),
  ]) {
    const result = spawnSync('bash', ['-e', '-c', gate.run], { cwd: root, encoding: 'utf8', env: { ...process.env, ...results } })
    assert.ifError(result.error)
    assert.equal(result.status, expected, JSON.stringify(results) + result.stdout + result.stderr)
  }
})
