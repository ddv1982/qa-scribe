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
  const current = preflightConsistencyCheck(sampleFiles('0.4.24'))
  assert.equal(current, '0.4.24')
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
  const versions = cargoLockCrateVersions(SAMPLE_CARGO_LOCK)
  assert.deepEqual(versions, {
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
  const once = bumpCargoTomlVersion(SAMPLE_CARGO_TOML, '0.4.24')
  assert.equal(once, SAMPLE_CARGO_TOML)
})

test('bumpCargoLockVersions updates all three qa-scribe crate entries', () => {
  const next = bumpCargoLockVersions(SAMPLE_CARGO_LOCK, '0.5.0')
  const versions = cargoLockCrateVersions(next)
  assert.deepEqual(versions, {
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
  const lines = next.split('\n')
  assert.equal(lines[0], '# Changelog')
  assert.equal(lines[2], '## v0.5.0 - 2026-07-03')
  assert.match(next, /## v0\.5\.0 - 2026-07-03[\s\S]*## v0\.4\.24 - 2026-07-02/)
})

test('insertChangelogScaffold is idempotent for an existing heading', () => {
  const once = insertChangelogScaffold(SAMPLE_CHANGELOG, 'v0.4.24', '2026-07-02')
  assert.equal(once, SAMPLE_CHANGELOG)
})

test('insertMetainfoRelease inserts a new release entry at the top of <releases>', () => {
  const next = insertMetainfoRelease(SAMPLE_METAINFO, '0.5.0', '2026-07-03')
  const releasesIndex = next.indexOf('<releases>')
  const newEntryIndex = next.indexOf('<release version="0.5.0" date="2026-07-03" />')
  const oldEntryIndex = next.indexOf('<release version="0.4.24" date="2026-07-02" />')
  assert.ok(releasesIndex < newEntryIndex)
  assert.ok(newEntryIndex < oldEntryIndex)
})

test('insertMetainfoRelease is idempotent for an existing release entry', () => {
  const once = insertMetainfoRelease(SAMPLE_METAINFO, '0.4.24', '2026-07-02')
  assert.equal(once, SAMPLE_METAINFO)
})

test('insertMetainfoRelease throws when <releases> is missing', () => {
  const malformed = SAMPLE_METAINFO.replace('<releases>', '<not-releases>')
  assert.throws(() => insertMetainfoRelease(malformed, '0.5.0', '2026-07-03'), /releases/)
})

test('buildPlan produces a change for every tracked file with the new version applied', () => {
  const files = sampleFiles('0.4.24')
  const plan = buildPlan(files, { newVersion: '0.5.0', today: '2026-07-03', metainfoPath: 'build/linux/io.github.ddv1982.qa-scribe.metainfo.xml' })
  const paths = plan.map(change => change.path).sort()
  assert.deepEqual(paths, [
    'CHANGELOG.md',
    'Cargo.lock',
    'Cargo.toml',
    'build/linux/io.github.ddv1982.qa-scribe.metainfo.xml',
    'frontend/package.json',
    'package.json',
    'src-tauri/tauri.conf.json'
  ])

  const packageJsonChange = plan.find(change => change.path === 'package.json')
  assert.equal(JSON.parse(packageJsonChange.nextContent).version, '0.5.0')

  const cargoLockChange = plan.find(change => change.path === 'Cargo.lock')
  assert.deepEqual(cargoLockCrateVersions(cargoLockChange.nextContent), {
    'qa-scribe-app': '0.5.0',
    'qa-scribe-core': '0.5.0',
    'qa-scribe-tauri': '0.5.0'
  })
})
