#!/usr/bin/env node
// Single write-path for bumping the qa-scribe release version.
//
// Updates, atomically (all files staged in memory, then written together)
// and idempotently (safe to re-run with the same target version):
//   - package.json `version`
//   - frontend/package.json `version`
//   - Cargo.toml `[workspace.package]` version
//   - Cargo.lock `version` for the qa-scribe-app/qa-scribe-core/qa-scribe-tauri entries
//   - src-tauri/tauri.conf.json `version`
//   - CHANGELOG.md: inserts a new `## <version> - <date>` scaffold at the top
//   - build/linux/<bundleId>.metainfo.xml: inserts a new <release> entry
//
// frontend/bun.lock does NOT need updating: it records dependency versions,
// not the root workspace's own `version` field (verified: `grep -c
// '"version"' frontend/bun.lock` is 0), so nothing there ever drifts from a
// version bump.
//
// Runs a pre-flight consistency check (reusing the same version-reading
// helpers as scripts/check-release-metadata.mjs) that fails loudly if the
// files disagree on the *current* version before bumping anything.
//
// Usage:
//   node scripts/bump-version.mjs <new-version> [--dry-run]

import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  QA_SCRIBE_CARGO_LOCK_PACKAGES,
  cargoLockPackageVersions,
  readReleaseConstants,
  readWorkspaceCargoVersion,
  validateSemver
} from './command-utils.mjs'

const PACKAGE_JSON_PATH = 'package.json'
const FRONTEND_PACKAGE_JSON_PATH = 'frontend/package.json'
const CARGO_TOML_PATH = 'Cargo.toml'
const CARGO_LOCK_PATH = 'Cargo.lock'
const TAURI_CONF_PATH = 'src-tauri/tauri.conf.json'
const CHANGELOG_PATH = 'CHANGELOG.md'
const CARGO_LOCK_CRATES = QA_SCRIBE_CARGO_LOCK_PACKAGES

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const positional = args.filter(arg => !arg.startsWith('--'))
  const newVersion = positional[0]

  if (!newVersion) {
    throw new Error('Usage: node scripts/bump-version.mjs <new-version> [--dry-run]')
  }
  if (!validateSemver(newVersion)) {
    throw new Error(`<new-version> must be semver-compatible, got ${newVersion}`)
  }

  const releaseConstants = readReleaseConstants()
  const metainfoPath = `build/linux/${releaseConstants.bundleId}.metainfo.xml`

  const files = await readAllFiles(metainfoPath)
  const currentVersion = preflightConsistencyCheck(files)

  if (currentVersion === newVersion) {
    console.log(`Version is already ${newVersion} everywhere; nothing to bump.`)
  }

  const today = new Date().toISOString().slice(0, 10)
  const plan = buildPlan(files, { newVersion, today, metainfoPath })

  printPlan(plan, { dryRun, currentVersion, newVersion })

  if (dryRun) {
    return
  }

  for (const change of plan) {
    await writeFile(change.path, change.nextContent, 'utf8')
  }

  console.log(`\nBumped version ${currentVersion} -> ${newVersion}.`)
  console.log(`Reminder: fill in the CHANGELOG.md entry for ## v${newVersion} - ${today} with real release notes before tagging.`)

  console.log('\nRunning scripts/check-release-metadata.mjs as verification...')
  const check = spawnSync(process.execPath, ['scripts/check-release-metadata.mjs', '--expected-tag', `v${newVersion}`], {
    stdio: 'inherit'
  })
  if (check.status !== 0) {
    throw new Error(
      'scripts/check-release-metadata.mjs failed after bump. This is expected until you fill in the CHANGELOG.md notes for the new version; fix and re-run to verify.'
    )
  }
}

async function readAllFiles(metainfoPath) {
  const [packageJsonRaw, frontendPackageJsonRaw, cargoToml, cargoLock, tauriConfRaw, changelog, metainfo] = await Promise.all([
    readFile(PACKAGE_JSON_PATH, 'utf8'),
    readFile(FRONTEND_PACKAGE_JSON_PATH, 'utf8'),
    readFile(CARGO_TOML_PATH, 'utf8'),
    readFile(CARGO_LOCK_PATH, 'utf8'),
    readFile(TAURI_CONF_PATH, 'utf8'),
    readFile(CHANGELOG_PATH, 'utf8'),
    readFile(metainfoPath, 'utf8')
  ])

  return {
    packageJsonRaw,
    packageJson: JSON.parse(packageJsonRaw),
    frontendPackageJsonRaw,
    frontendPackageJson: JSON.parse(frontendPackageJsonRaw),
    cargoToml,
    cargoLock,
    tauriConfRaw,
    tauriConf: JSON.parse(tauriConfRaw),
    changelog,
    metainfo,
    metainfoPath
  }
}

function preflightConsistencyCheck(files) {
  const versions = {
    'package.json': files.packageJson.version,
    'frontend/package.json': files.frontendPackageJson.version,
    'Cargo.toml [workspace.package]': readWorkspaceCargoVersion(files.cargoToml),
    'src-tauri/tauri.conf.json': files.tauriConf.version
  }

  const cargoLockVersions = cargoLockCrateVersions(files.cargoLock)
  for (const crate of CARGO_LOCK_CRATES) {
    versions[`Cargo.lock (${crate})`] = cargoLockVersions[crate] ?? null
  }

  const distinct = new Set(Object.values(versions))
  const hasMissing = Object.values(versions).some(v => v == null)
  if (distinct.size !== 1 || hasMissing) {
    const summary = Object.entries(versions)
      .map(([label, version]) => `  - ${label}: ${version ?? '<missing>'}`)
      .join('\n')
    throw new Error(`Version files disagree; refusing to bump until they match:\n${summary}`)
  }

  const [currentVersion] = distinct
  if (!validateSemver(currentVersion)) {
    throw new Error(`Current version ${currentVersion} is not semver-compatible`)
  }

  return currentVersion
}

function cargoLockCrateVersions(cargoLock) {
  return cargoLockPackageVersions(cargoLock, CARGO_LOCK_CRATES)
}

function buildPlan(files, { newVersion, today, metainfoPath }) {
  const plan = []

  const nextPackageJson = { ...files.packageJson, version: newVersion }
  plan.push({
    path: PACKAGE_JSON_PATH,
    description: `version -> ${newVersion}`,
    nextContent: `${JSON.stringify(nextPackageJson, null, 2)}\n`
  })

  const nextFrontendPackageJson = { ...files.frontendPackageJson, version: newVersion }
  plan.push({
    path: FRONTEND_PACKAGE_JSON_PATH,
    description: `version -> ${newVersion}`,
    nextContent: `${JSON.stringify(nextFrontendPackageJson, null, 2)}\n`
  })

  plan.push({
    path: CARGO_TOML_PATH,
    description: `[workspace.package] version -> ${newVersion}`,
    nextContent: bumpCargoTomlVersion(files.cargoToml, newVersion)
  })

  plan.push({
    path: CARGO_LOCK_PATH,
    description: `${CARGO_LOCK_CRATES.join(', ')} version -> ${newVersion}`,
    nextContent: bumpCargoLockVersions(files.cargoLock, newVersion)
  })

  const nextTauriConf = { ...files.tauriConf, version: newVersion }
  plan.push({
    path: TAURI_CONF_PATH,
    description: `version -> ${newVersion}`,
    nextContent: `${JSON.stringify(nextTauriConf, null, 2)}\n`
  })

  const changelogTag = `v${newVersion}`
  plan.push({
    path: CHANGELOG_PATH,
    description: `insert ## ${changelogTag} - ${today} scaffold`,
    nextContent: insertChangelogScaffold(files.changelog, changelogTag, today)
  })

  plan.push({
    path: metainfoPath,
    description: `insert <release version="${newVersion}" date="${today}" />`,
    nextContent: insertMetainfoRelease(files.metainfo, newVersion, today)
  })

  return plan
}

function bumpCargoTomlVersion(cargoToml, newVersion) {
  const workspacePackageMatch = cargoToml.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/)
  if (!workspacePackageMatch) {
    throw new Error('Cargo.toml is missing [workspace.package]')
  }
  const section = workspacePackageMatch[0]
  const versionLinePattern = /^(\s*version\s*=\s*)"[^"]+"/m
  if (!versionLinePattern.test(section)) {
    throw new Error('Cargo.toml [workspace.package] is missing a version field')
  }
  const nextSection = section.replace(versionLinePattern, `$1"${newVersion}"`)
  return cargoToml.replace(section, nextSection)
}

function bumpCargoLockVersions(cargoLock, newVersion) {
  let next = cargoLock
  for (const crate of CARGO_LOCK_CRATES) {
    const pattern = new RegExp(`(\\[\\[package\\]\\]\\nname = "${crate}"\\nversion = )"[^"]+"`)
    if (!pattern.test(next)) {
      throw new Error(`Cargo.lock is missing a [[package]] entry for ${crate}`)
    }
    next = next.replace(pattern, `$1"${newVersion}"`)
  }
  return next
}

function insertChangelogScaffold(changelog, tag, today) {
  const heading = `## ${tag} - ${today}`
  if (changelog.includes(`\n${heading}\n`) || changelog.startsWith(`${heading}\n`)) {
    return changelog
  }

  const lines = changelog.split(/\r?\n/)
  const titleIndex = lines.findIndex(line => line.startsWith('# '))
  const insertAt = titleIndex === -1 ? 0 : titleIndex + 1

  const scaffold = ['', heading, '', '- TODO: describe this release.', '']
  const nextLines = [...lines.slice(0, insertAt), ...scaffold, ...lines.slice(insertAt)]
  return nextLines.join('\n').replace(/\n{3,}/g, '\n\n')
}

function insertMetainfoRelease(metainfo, newVersion, today) {
  const existingEntry = new RegExp(`<release version="${escapeRegExpLocal(newVersion)}" date="[^"]*" />`)
  if (existingEntry.test(metainfo)) {
    return metainfo
  }

  const releasesOpenTag = /<releases>\s*\n/
  if (!releasesOpenTag.test(metainfo)) {
    throw new Error('metainfo file is missing a <releases> element')
  }

  return metainfo.replace(releasesOpenTag, match => `${match}    <release version="${newVersion}" date="${today}" />\n`)
}

function escapeRegExpLocal(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function printPlan(plan, { dryRun, currentVersion, newVersion }) {
  console.log(`${dryRun ? '[dry-run] ' : ''}Bumping version ${currentVersion} -> ${newVersion}`)
  for (const change of plan) {
    console.log(`  ${dryRun ? 'would update' : 'updating'} ${change.path}: ${change.description}`)
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMainModule) {
  main().catch(error => {
    console.error(`error: ${error.message}`)
    process.exitCode = 1
  })
}

export {
  buildPlan,
  bumpCargoLockVersions,
  bumpCargoTomlVersion,
  cargoLockCrateVersions,
  insertChangelogScaffold,
  insertMetainfoRelease,
  preflightConsistencyCheck
}
