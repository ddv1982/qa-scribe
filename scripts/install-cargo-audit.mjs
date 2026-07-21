import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const STABLE_SEMVER = /^\d+\.\d+\.\d+$/

export function readCargoAuditVersion(
  toolVersions = JSON.parse(readFileSync(new URL('./tool-versions.json', import.meta.url), 'utf8')),
) {
  const version = toolVersions.cargoAudit
  if (typeof version !== 'string' || !STABLE_SEMVER.test(version)) {
    throw new Error('scripts/tool-versions.json must contain a stable cargoAudit version')
  }
  return version
}

export function installCargoAudit(version, spawn = spawnSync) {
  const result = spawn(
    'cargo',
    ['install', 'cargo-audit', '--locked', '--version', `=${version}`],
    { stdio: 'inherit' },
  )

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`cargo install cargo-audit exited with status ${result.status}`)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const version = readCargoAuditVersion()
  console.log(`Installing pinned cargo-audit ${version}`)
  installCargoAudit(version)
}
