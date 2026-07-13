import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TAURI_LOCK_ENTRY = /^\[\[package\]\]\s+name = "tauri"\s+version = "([^"]+)"/m
const STABLE_SEMVER = /^\d+\.\d+\.\d+$/

export function readTauriCoreVersion(lockfile = readFileSync(new URL('../Cargo.lock', import.meta.url), 'utf8')) {
  const match = lockfile.match(TAURI_LOCK_ENTRY)
  if (!match) {
    throw new Error('Cargo.lock does not contain a tauri package entry')
  }
  return match[1]
}

export function readTauriCliVersion(
  toolVersions = JSON.parse(readFileSync(new URL('./tool-versions.json', import.meta.url), 'utf8')),
) {
  const version = toolVersions.tauriCli
  if (typeof version !== 'string' || !STABLE_SEMVER.test(version)) {
    throw new Error('scripts/tool-versions.json must contain a stable tauriCli version')
  }
  return version
}

export function assertTauriCliCompatibility(cliVersion, coreVersion) {
  if (!STABLE_SEMVER.test(cliVersion) || !STABLE_SEMVER.test(coreVersion)) {
    throw new Error('Tauri CLI and core compatibility requires stable semantic versions')
  }
  const [cliMajor, cliMinor] = cliVersion.split('.')
  const [coreMajor, coreMinor] = coreVersion.split('.')
  if (cliMajor !== coreMajor || cliMinor !== coreMinor) {
    throw new Error(`tauri-cli ${cliVersion} is not minor-compatible with tauri ${coreVersion}`)
  }
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
  const cliVersion = readTauriCliVersion()
  const coreVersion = readTauriCoreVersion()
  assertTauriCliCompatibility(cliVersion, coreVersion)
  console.log(`Installing pinned tauri-cli ${cliVersion} (compatible with tauri ${coreVersion})`)
  installTauriCli(cliVersion)
}
