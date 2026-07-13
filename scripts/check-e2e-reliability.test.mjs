import assert from 'node:assert/strict'
import test from 'node:test'

import { assessReliability, listArtifacts, requestedPlatform } from './check-e2e-reliability.mjs'

function artifact(index, status = 'passed', attempt = 1, platform = 'linux') {
  const prefix = platform === 'linux' ? 'qa-scribe-e2e' : `qa-scribe-e2e-${platform}`
  return {
    name: `${prefix}-${status}-${1_000 + index}-${attempt}`,
    created_at: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
    expired: false,
  }
}

test('requires twenty consecutive first-attempt passes', () => {
  const result = assessReliability(Array.from({ length: 20 }, (_, index) => artifact(index)))
  assert.equal(result.ready, true)
  assert.equal(result.executions.length, 20)
})

test('rejects a failure or rerun in the most recent evidence window', () => {
  const artifacts = Array.from({ length: 20 }, (_, index) => artifact(index))
  artifacts.push(artifact(19, 'failed', 2))
  const result = assessReliability(artifacts)
  assert.equal(result.ready, false)
  assert.ok(result.failures.some((failure) => failure.includes('failed')))
  assert.ok(result.failures.some((failure) => failure.includes('attempt 2')))
})

test('does not count expired or missing evidence', () => {
  const artifacts = Array.from({ length: 19 }, (_, index) => artifact(index))
  artifacts.push({ ...artifact(19), expired: true })
  const result = assessReliability(artifacts)
  assert.equal(result.ready, false)
  assert.match(result.failures[0], /only 19 of 20/)
})

test('tracks Linux and macOS evidence independently', () => {
  const linux = Array.from({ length: 20 }, (_, index) => artifact(index))
  const macos = Array.from({ length: 19 }, (_, index) => artifact(index, 'passed', 1, 'macos'))
  assert.equal(assessReliability([...linux, ...macos]).ready, true)
  assert.equal(assessReliability([...linux, ...macos], 20, 'macos').ready, false)
})

test('accepts explicit platform arguments and rejects unsupported platforms', () => {
  assert.equal(requestedPlatform([]), 'linux')
  assert.equal(requestedPlatform(['--platform', 'macos']), 'macos')
  assert.equal(requestedPlatform(['--platform=macos']), 'macos')
  assert.throws(() => requestedPlatform(['--platform', 'windows']), /Unsupported E2E platform/)
  assert.throws(() => requestedPlatform(['--unknown']), /Unknown argument/)
})

test('artifact discovery pages past unrelated repository artifacts', async () => {
  const pages = [
    Array.from({ length: 100 }, (_, index) => ({ name: `package-${index}`, created_at: '2026-07-13T00:00:00Z', expired: false })),
    Array.from({ length: 20 }, (_, index) => artifact(index)),
  ]
  const requested = []
  const fetchImpl = async (url) => {
    requested.push(url)
    return {
      ok: true,
      json: async () => ({ artifacts: pages[requested.length - 1] }),
    }
  }

  const artifacts = await listArtifacts('owner/repository', 'token', fetchImpl)
  assert.equal(artifacts.length, 120)
  assert.equal(requested.length, 2)
})

test('artifact discovery pages until the requested platform has enough evidence', async () => {
  const pages = [
    [
      ...Array.from({ length: 20 }, (_, index) => artifact(index)),
      ...Array.from({ length: 80 }, (_, index) => ({ name: `package-${index}`, created_at: '2026-07-13T00:00:00Z', expired: false })),
    ],
    Array.from({ length: 20 }, (_, index) => artifact(index, 'passed', 1, 'macos')),
  ]
  const requested = []
  const fetchImpl = async (url) => {
    requested.push(url)
    return {
      ok: true,
      json: async () => ({ artifacts: pages[requested.length - 1] }),
    }
  }

  const artifacts = await listArtifacts('owner/repository', 'token', fetchImpl, 20, 'macos')
  assert.equal(artifacts.length, 120)
  assert.equal(requested.length, 2)
})
