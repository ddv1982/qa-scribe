import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./normalize-ci-rust-toolchains.sh', import.meta.url))
const host = 'x86_64-unknown-linux-gnu'
const pinned = `1.99.1-${host}`

function run(overrides = {}, environment = 'github-hosted') {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-rust-inventory-'))
  const stateFile = join(directory, 'state.json')
  const initial = {
    active: pinned, default: `stable-${host}`, host,
    installed: [pinned, `stable-${host}`, `nightly-${host}`, 'custom-toolchain'],
    calls: [], ...overrides,
  }
  writeFileSync(stateFile, JSON.stringify(initial))
  const rustup = `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs'
const file = process.env.INVENTORY_STATE
const state = JSON.parse(readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
state.calls.push(args)
writeFileSync(file, JSON.stringify(state))
if (state.fail === args.slice(0, 2).join(' ')) process.exit(17)
if (args[0] === 'show') console.log(state.active + ' (overridden by rust-toolchain.toml)')
else if (args[0] === 'default') state.default = args[1]
else if (args[1] === 'list') console.log(state.installed.join('\\n'))
else if (args[1] === 'uninstall') {
  if (state.default === args[2]) process.exit(18)
  state.installed = state.installed.filter(name => name !== args[2])
} else process.exit(19)
writeFileSync(file, JSON.stringify(state))
`
  writeFileSync(join(directory, 'rustup'), rustup, { mode: 0o755 })
  writeFileSync(join(directory, 'rustc'), `#!${process.execPath}
import { readFileSync } from 'node:fs'
const state = JSON.parse(readFileSync(process.env.INVENTORY_STATE, 'utf8'))
console.log('rustc 1.99.1\\nhost: ' + state.host + '\\nrelease: 1.99.1')
`, { mode: 0o755 })
  const env = {
    ...process.env, PATH: `${directory}:${process.env.PATH}`,
    RUNNER_ENVIRONMENT: environment, PINNED_RUST_TOOLCHAIN: '1.99.1', INVENTORY_STATE: stateFile,
  }
  try {
    const result = spawnSync('bash', [script], { env, encoding: 'utf8' })
    assert.ifError(result.error)
    const first = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (result.status === 0 && environment === 'github-hosted') {
      const repeated = spawnSync('bash', [script], { env, encoding: 'utf8' })
      assert.equal(repeated.status, 0, repeated.stderr)
      assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')).installed, first.installed)
    }
    return { ...result, state: first, initial }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('hosted normalization retains the active pin and replaces an unused default before pruning', () => {
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.state.installed, [pinned])
  assert.equal(result.state.default, pinned)
  assert.deepEqual(result.state.calls.filter(call => call[1] === 'uninstall'), [
    ['toolchain', 'uninstall', `stable-${host}`],
    ['toolchain', 'uninstall', `nightly-${host}`],
    ['toolchain', 'uninstall', 'custom-toolchain'],
  ])
})

test('unused runner compiler changes converge to the same retained inventory', () => {
  const before = run({ installed: [pinned, `1.99.0-${host}`] })
  const after = run({ installed: [pinned, `1.99.1-preinstalled-${host}`] })
  assert.equal(before.status, 0, before.stderr)
  assert.equal(after.status, 0, after.stderr)
  assert.deepEqual(before.state.installed, [pinned])
  assert.deepEqual(after.state.installed, [pinned])
})

test('local and self-hosted environments never invoke rustup or change inventory', () => {
  for (const environment of ['', 'self-hosted']) {
    const result = run({}, environment)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.state, result.initial)
  }
})

test('a different active compiler or host fails before changing the default or uninstalling', () => {
  for (const active of [`1.97.0-${host}`, `stable-${host}`, 'custom-toolchain']) {
    const result = run({ active })
    assert.equal(result.status, 1, result.stderr)
    assert.deepEqual(result.state.installed, result.initial.installed)
    assert.equal(result.state.default, result.initial.default)
    assert.deepEqual(result.state.calls, [['show', 'active-toolchain']])
  }
  const result = run({ host: '' })
  assert.equal(result.status, 1)
  assert.deepEqual(result.state.installed, result.initial.installed)
})

test('default, inventory, and uninstall errors stop normalization', () => {
  for (const fail of ['default ' + pinned, 'toolchain list', 'toolchain uninstall']) {
    const result = run({ fail })
    assert.equal(result.status, 17, result.stderr)
    assert.deepEqual(result.state.installed, result.initial.installed)
  }
})
