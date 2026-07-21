import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPlan,
  bumpCargoLockVersions,
  bumpCargoTomlVersion,
  cargoLockCrateVersions,
  insertChangelogScaffold,
  insertMetainfoRelease,
  preflightConsistencyCheck
} from './bump-version.mjs'

const SAMPLE_CARGO_TOML = `[workspace]
members = [
  "crates/qa-scribe-app",
  "crates/qa-scribe-core",
  "src-tauri",
]
resolver = "3"

[workspace.package]
version = "0.4.24"
edition = "2024"
license = "MIT"
authors = ["qa-scribe contributors"]

[workspace.dependencies]
qa-scribe-core = { path = "crates/qa-scribe-core" }
`

const SAMPLE_CARGO_LOCK = `# auto-generated
[[package]]
name = "qa-scribe-app"
version = "0.4.24"
dependencies = [
 "qa-scribe-core",
]

[[package]]
name = "qa-scribe-core"
version = "0.4.24"
dependencies = [
 "base64",
]

[[package]]
name = "qa-scribe-tauri"
version = "0.4.24"
dependencies = [
 "base64",
]
`

const SAMPLE_CHANGELOG = `# Changelog

## v0.4.24 - 2026-07-02

- Some prior release notes.

## v0.4.23 - 2026-07-02

- Older notes.
`

const SAMPLE_METAINFO = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>io.github.ddv1982.qa-scribe</id>
  <releases>
    <release version="0.4.24" date="2026-07-02" />
    <release version="0.4.23" date="2026-07-02" />
  </releases>
</component>
`

function samplePackageJson(version) {
  return { name: 'qa-scribe', version }
}

function sampleFrontendPackageJson(version) {
  return { name: 'qa-scribe-frontend', version }
}

function sampleTauriConf(version) {
  return { version, identifier: 'io.github.ddv1982.qa-scribe' }
}

function sampleFiles(version) {
  return {
    packageJson: samplePackageJson(version),
    frontendPackageJson: sampleFrontendPackageJson(version),
    cargoToml: SAMPLE_CARGO_TOML.replace('version = "0.4.24"', `version = "${version}"`),
    cargoLock: SAMPLE_CARGO_LOCK.replaceAll('version = "0.4.24"', `version = "${version}"`),
    tauriConf: sampleTauriConf(version),
    changelog: SAMPLE_CHANGELOG,
    metainfo: SAMPLE_METAINFO
  }
}

test('preflightConsistencyCheck returns the shared current version', () => {
  assert.equal(preflightConsistencyCheck(sampleFiles('0.4.24')), '0.4.24')
})

test('preflightConsistencyCheck throws loudly when files disagree', () => {
  const files = sampleFiles('0.4.24')
  files.frontendPackageJson = sampleFrontendPackageJson('9.9.9')
  assert.throws(() => preflightConsistencyCheck(files), /disagree/)
})

test('preflightConsistencyCheck throws loudly when Cargo.lock versions drift', () => {
  const files = sampleFiles('0.4.24')
  files.cargoLock = SAMPLE_CARGO_LOCK.replace('name = "qa-scribe-core"\nversion = "0.4.24"', 'name = "qa-scribe-core"\nversion = "9.9.9"')
  assert.throws(() => preflightConsistencyCheck(files), /Cargo\.lock \(qa-scribe-core\): 9\.9\.9/)
})

test('preflightConsistencyCheck throws when a version is missing entirely', () => {
  const files = sampleFiles('0.4.24')
  files.cargoToml = SAMPLE_CARGO_TOML.replace('[workspace.package]', '[not.workspace.package]')
  assert.throws(() => preflightConsistencyCheck(files), /disagree/)
})

test('cargoLockCrateVersions reads all three qa-scribe crate versions', () => {
  assert.deepEqual(cargoLockCrateVersions(SAMPLE_CARGO_LOCK), {
    'qa-scribe-app': '0.4.24',
    'qa-scribe-core': '0.4.24',
    'qa-scribe-tauri': '0.4.24'
  })
})

test('bumpCargoTomlVersion updates only the workspace.package version', () => {
  const next = bumpCargoTomlVersion(SAMPLE_CARGO_TOML, '0.5.0')
  assert.match(next, /\[workspace\.package\][\s\S]*version = "0\.5\.0"/)
  assert.doesNotMatch(next, /version = "0\.4\.24"/)
})

test('bumpCargoTomlVersion is idempotent when already at the target version', () => {
  assert.equal(bumpCargoTomlVersion(SAMPLE_CARGO_TOML, '0.4.24'), SAMPLE_CARGO_TOML)
})

test('bumpCargoLockVersions updates all three qa-scribe crate entries', () => {
  assert.deepEqual(cargoLockCrateVersions(bumpCargoLockVersions(SAMPLE_CARGO_LOCK, '0.5.0')), {
    'qa-scribe-app': '0.5.0',
    'qa-scribe-core': '0.5.0',
    'qa-scribe-tauri': '0.5.0'
  })
})

test('bumpCargoLockVersions throws if a crate entry is missing', () => {
  const withoutTauri = SAMPLE_CARGO_LOCK.replace(/\[\[package\]\]\nname = "qa-scribe-tauri"[\s\S]*$/, '')
  assert.throws(() => bumpCargoLockVersions(withoutTauri, '0.5.0'), /qa-scribe-tauri/)
})

test('insertChangelogScaffold inserts a new heading right after the title', () => {
  const next = insertChangelogScaffold(SAMPLE_CHANGELOG, 'v0.5.0', '2026-07-03')
  assert.equal(next.split('\n')[2], '## v0.5.0 - 2026-07-03')
  assert.match(next, /## v0\.5\.0 - 2026-07-03[\s\S]*## v0\.4\.24 - 2026-07-02/)
})

test('insertChangelogScaffold is idempotent for an existing version even on a later date', () => {
  assert.equal(insertChangelogScaffold(SAMPLE_CHANGELOG, 'v0.4.24', '2026-07-20'), SAMPLE_CHANGELOG)
})

test('insertMetainfoRelease inserts a new release entry at the top of releases', () => {
  const next = insertMetainfoRelease(SAMPLE_METAINFO, '0.5.0', '2026-07-03')
  assert.ok(next.indexOf('<releases>') < next.indexOf('<release version="0.5.0"'))
  assert.ok(next.indexOf('<release version="0.5.0"') < next.indexOf('<release version="0.4.24"'))
})

test('insertMetainfoRelease is idempotent for an existing release entry', () => {
  assert.equal(insertMetainfoRelease(SAMPLE_METAINFO, '0.4.24', '2026-07-02'), SAMPLE_METAINFO)
})

test('insertMetainfoRelease throws when releases are missing', () => {
  assert.throws(
    () => insertMetainfoRelease(SAMPLE_METAINFO.replace('<releases>', '<not-releases>'), '0.5.0', '2026-07-03'),
    /releases/
  )
})

test('buildPlan produces a change for every tracked file with the new version applied', () => {
  const plan = buildPlan(sampleFiles('0.4.24'), {
    newVersion: '0.5.0',
    today: '2026-07-03',
    metainfoPath: 'build/linux/io.github.ddv1982.qa-scribe.metainfo.xml'
  })
  assert.deepEqual(plan.map(change => change.path).sort(), [
    'CHANGELOG.md',
    'Cargo.lock',
    'Cargo.toml',
    'build/linux/io.github.ddv1982.qa-scribe.metainfo.xml',
    'frontend/package.json',
    'package.json',
    'src-tauri/tauri.conf.json'
  ])
  assert.equal(JSON.parse(plan.find(change => change.path === 'package.json').nextContent).version, '0.5.0')
})

test('buildPlan is content-idempotent when the target version is already current', () => {
  const files = {
    ...sampleFiles('0.4.24'),
    packageJsonRaw: `${JSON.stringify(samplePackageJson('0.4.24'), null, 2)}\n`,
    frontendPackageJsonRaw: `${JSON.stringify(sampleFrontendPackageJson('0.4.24'), null, 2)}\n`,
    tauriConfRaw: `${JSON.stringify(sampleTauriConf('0.4.24'), null, 2)}\n`
  }
  const plan = buildPlan(files, {
    newVersion: '0.4.24',
    today: '2026-07-20',
    metainfoPath: 'build/linux/io.github.ddv1982.qa-scribe.metainfo.xml'
  })
  assert.ok(plan.every(change => change.nextContent === change.previousContent))
})
