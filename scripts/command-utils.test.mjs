import assert from 'node:assert/strict'
import test from 'node:test'
import { releaseNotesContainPlaceholder, validateSemver, validateStableSemver } from './command-utils.mjs'

test('validateSemver accepts prerelease and build metadata for general semver parsing', () => {
  assert.equal(validateSemver('1.2.3'), true)
  assert.equal(validateSemver('1.2.3-alpha.1'), true)
  assert.equal(validateSemver('1.2.3+build.1'), true)
})

test('validateStableSemver accepts only stable release versions', () => {
  assert.equal(validateStableSemver('1.2.3'), true)
  assert.equal(validateStableSemver('1.2.3-alpha.1'), false)
  assert.equal(validateStableSemver('1.2.3+build.1'), false)
  assert.equal(validateStableSemver('v1.2.3'), false)
})

test('releaseNotesContainPlaceholder detects the bump-version TODO line', () => {
  assert.equal(releaseNotesContainPlaceholder('- TODO: describe this release.'), true)
  assert.equal(releaseNotesContainPlaceholder('\n  - todo: describe this release.  \n'), true)
  assert.equal(releaseNotesContainPlaceholder('- Fix generated testware persistence.'), false)
})
