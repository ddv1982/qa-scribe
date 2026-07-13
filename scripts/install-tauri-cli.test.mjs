import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertTauriCliCompatibility,
  installTauriCli,
  readTauriCliVersion,
  readTauriCoreVersion,
} from './install-tauri-cli.mjs'

test('readTauriCoreVersion reads the resolved Tauri package version', () => {
  assert.equal(
    readTauriCoreVersion(`
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

test('readTauriCoreVersion rejects a lockfile without Tauri', () => {
  assert.throws(() => readTauriCoreVersion('[[package]]\nname = "other"\nversion = "1.0.0"'), /tauri package entry/)
})

test('readTauriCliVersion reads and validates the explicit tool pin', () => {
  assert.equal(readTauriCliVersion({ tauriCli: '2.11.4' }), '2.11.4')
  assert.throws(() => readTauriCliVersion({}), /stable tauriCli version/)
  assert.throws(() => readTauriCliVersion({ tauriCli: '2.11.4-beta.1' }), /stable tauriCli version/)
})

test('Tauri CLI compatibility permits patch skew but not minor skew', () => {
  assert.doesNotThrow(() => assertTauriCliCompatibility('2.11.4', '2.11.5'))
  assert.throws(() => assertTauriCliCompatibility('2.10.4', '2.11.5'), /not minor-compatible/)
})

test('the repository pins a stable Tauri CLI compatible with the locked runtime', () => {
  const cliVersion = readTauriCliVersion()
  const coreVersion = readTauriCoreVersion()
  assert.equal(cliVersion, '2.11.4')
  assert.doesNotThrow(() => assertTauriCliCompatibility(cliVersion, coreVersion))
})

test('installTauriCli invokes cargo-binstall with the exact tool pin', () => {
  let invocation
  installTauriCli('2.11.4', (command, args, options) => {
    invocation = { command, args, options }
    return { status: 0 }
  })

  assert.deepEqual(invocation, {
    command: 'cargo',
    args: ['binstall', 'tauri-cli', '--locked', '--version', '=2.11.4', '--no-confirm', '--force'],
    options: { stdio: 'inherit' },
  })
})

test('installTauriCli rejects a failed cargo-binstall process', () => {
  assert.throws(() => installTauriCli('2.11.4', () => ({ status: 7 })), /status 7/)
})
