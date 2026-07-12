import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TAURI_LOCK_ENTRY = /^\[\[package\]\]\s+name = "tauri"\s+version = "([^"]+)"/m

export function readTauriCliVersion(lockfile = readFileSync(new URL('../Cargo.lock', import.meta.url), 'utf8')) {
  const match = lockfile.match(TAURI_LOCK_ENTRY)
  if (!match) {
    throw new Error('Cargo.lock does not contain a tauri package entry')
  }
  return match[1]
}

export function installTauriCli(version, spawn = spawnSync) {
  const result = spawn(
    'cargo',
    ['binstall', 'tauri-cli', '--locked', '--version', `=${version}`, '--no-confirm', '--force'],
    { stdio: 'inherit' },
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`cargo binstall exited with status ${result.status}`)
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const version = readTauriCliVersion()
  console.log(`Installing tauri-cli ${version} (resolved from Cargo.lock)`)
  installTauriCli(version)
}
