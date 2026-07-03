import assert from 'node:assert/strict'
import test from 'node:test'
import { checkMonotonic, compareVersions, extractPackageVersion, packagesUrl } from './check-apt-monotonic.mjs'

test('compareVersions orders X.Y.Z numerically, not lexically', () => {
  assert.equal(compareVersions('0.4.9', '0.4.10'), -1)
  assert.equal(compareVersions('0.4.10', '0.4.9'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1)
})

test('extractPackageVersion reads the Version field from the matching stanza', () => {
  const packages = [
    'Package: qa-scribe-repository-setup',
    'Version: 1.0',
    'Architecture: all',
    '',
    'Package: qa-scribe',
    'Version: 0.4.24',
    'Architecture: amd64'
  ].join('\n')

  assert.equal(extractPackageVersion(packages, 'qa-scribe'), '0.4.24')
  assert.equal(extractPackageVersion(packages, 'qa-scribe-repository-setup'), '1.0')
  assert.equal(extractPackageVersion(packages, 'does-not-exist'), null)
})

test('packagesUrl composes pagesBaseUrl and aptRepoPath from release constants', () => {
  const url = packagesUrl({
    pagesBaseUrl: 'https://ddv1982.github.io/qa-scribe/apt/',
    aptRepoPath: 'dists/stable'
  })
  assert.equal(url, 'https://ddv1982.github.io/qa-scribe/apt/dists/stable/main/binary-amd64/Packages')
})

test('checkMonotonic allows first publish on a 404', async () => {
  const result = await checkMonotonic({
    publishingVersion: '0.4.24',
    releaseConstants: { pagesBaseUrl: 'https://example.invalid/apt/', aptRepoPath: 'dists/stable' },
    fetchImpl: async () => new Response('not found', { status: 404 })
  })
  assert.equal(result.status, 'first-publish')
})

test('checkMonotonic allows an idempotent re-run when versions are equal', async () => {
  const packages = 'Package: qa-scribe\nVersion: 0.4.24\nArchitecture: amd64\n'
  const result = await checkMonotonic({
    publishingVersion: '0.4.24',
    releaseConstants: { pagesBaseUrl: 'https://example.invalid/apt/', aptRepoPath: 'dists/stable' },
    fetchImpl: async () => new Response(packages, { status: 200 })
  })
  assert.equal(result.status, 'idempotent-rerun')
  assert.equal(result.liveVersion, '0.4.24')
})

test('checkMonotonic allows publishing a newer version than the live one', async () => {
  const packages = 'Package: qa-scribe\nVersion: 0.4.23\nArchitecture: amd64\n'
  const result = await checkMonotonic({
    publishingVersion: '0.4.24',
    releaseConstants: { pagesBaseUrl: 'https://example.invalid/apt/', aptRepoPath: 'dists/stable' },
    fetchImpl: async () => new Response(packages, { status: 200 })
  })
  assert.equal(result.status, 'newer-publish')
})

test('checkMonotonic fails when the live version is newer than the one being published', async () => {
  const packages = 'Package: qa-scribe\nVersion: 0.5.0\nArchitecture: amd64\n'
  await assert.rejects(
    () =>
      checkMonotonic({
        publishingVersion: '0.4.24',
        releaseConstants: { pagesBaseUrl: 'https://example.invalid/apt/', aptRepoPath: 'dists/stable' },
        fetchImpl: async () => new Response(packages, { status: 200 })
      }),
    /Refusing to publish APT repository/
  )
})

test('checkMonotonic fails on a non-404 error response', async () => {
  await assert.rejects(
    () =>
      checkMonotonic({
        publishingVersion: '0.4.24',
        releaseConstants: { pagesBaseUrl: 'https://example.invalid/apt/', aptRepoPath: 'dists/stable' },
        fetchImpl: async () => new Response('server error', { status: 500 })
      }),
    /Failed to fetch live APT Packages index \(500\)/
  )
})

test('checkMonotonic fails when the live index has no qa-scribe stanza', async () => {
  await assert.rejects(
    () =>
      checkMonotonic({
        publishingVersion: '0.4.24',
        releaseConstants: { pagesBaseUrl: 'https://example.invalid/apt/', aptRepoPath: 'dists/stable' },
        fetchImpl: async () => new Response('Package: some-other-package\nVersion: 1.0\n', { status: 200 })
      }),
    /does not contain a qa-scribe stanza/
  )
})
