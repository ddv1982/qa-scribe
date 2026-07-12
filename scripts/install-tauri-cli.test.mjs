import assert from 'node:assert/strict'
import test from 'node:test'

import { installTauriCli, readTauriCliVersion } from './install-tauri-cli.mjs'

test('readTauriCliVersion reads the resolved Tauri package version', () => {
  assert.equal(
    readTauriCliVersion(`
[[package]]
name = "other"
version = "1.0.0"

[[package]]
name = "tauri"
version = "2.11.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
`),
    '2.11.3',
  )
})

test('readTauriCliVersion rejects a lockfile without Tauri', () => {
  assert.throws(() => readTauriCliVersion('[[package]]\nname = "other"\nversion = "1.0.0"'), /tauri package entry/)
})

test('the repository lockfile exposes a stable Tauri CLI version', () => {
  assert.match(readTauriCliVersion(), /^\d+\.\d+\.\d+$/)
})

test('installTauriCli invokes cargo-binstall with an exact version', () => {
  let invocation
  installTauriCli('2.11.3', (command, args, options) => {
    invocation = { command, args, options }
    return { status: 0 }
  })

  assert.deepEqual(invocation, {
    command: 'cargo',
    args: ['binstall', 'tauri-cli', '--locked', '--version', '=2.11.3', '--no-confirm', '--force'],
    options: { stdio: 'inherit' },
  })
})

test('installTauriCli rejects a failed cargo-binstall process', () => {
  assert.throws(() => installTauriCli('2.11.3', () => ({ status: 7 })), /status 7/)
})
