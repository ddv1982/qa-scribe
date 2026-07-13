import assert from 'node:assert/strict'
import test from 'node:test'
import { auditSummaryLine, compareAudit } from './check-rust-audit.mjs'

function report(id = 'RUSTSEC-2026-0001') {
  return {
    vulnerabilities: { list: [{ advisory: { id }, package: { name: 'example', version: '1.0.0' } }] },
    warnings: {},
  }
}

function registry(id = 'RUSTSEC-2026-0001') {
  return {
    reviewedAt: '2026-07-13',
    nextReviewDate: '2026-10-13',
    exceptions: [{
      id,
      classification: 'vulnerability',
      package: 'example',
      version: '1.0.0',
      targets: ['linux'],
      exposure: 'Test exposure.',
      dependencyPath: 'app -> example',
      blocker: 'Upstream constraint.',
      patchedVersions: ['>=2.0.0'],
      reviewDate: '2026-10-13',
      removalTrigger: 'Upgrade upstream.',
    }],
  }
}

test('compareAudit accepts an exact, current registry', () => {
  assert.deepEqual(compareAudit(report(), registry(), '2026-07-13').errors, [])
})

test('compareAudit fails new and stale findings', () => {
  assert.match(compareAudit(report('RUSTSEC-NEW'), registry(), '2026-07-13').errors.join('\n'), /new vulnerability/)
  assert.match(compareAudit(report('RUSTSEC-NEW'), registry(), '2026-07-13').errors.join('\n'), /registry entry is stale/)
})

test('compareAudit fails expired or incomplete metadata', () => {
  const expired = registry()
  expired.exceptions[0].reviewDate = '2026-07-12'
  expired.exceptions[0].dependencyPath = ''
  const errors = compareAudit(report(), expired, '2026-07-13').errors.join('\n')
  assert.match(errors, /missing dependencyPath/)
  assert.match(errors, /review expired/)
})

test('compareAudit rejects malformed registry dates and version metadata', () => {
  const malformed = registry()
  malformed.reviewedAt = '2026-99-13'
  malformed.nextReviewDate = 'not-a-date'
  malformed.exceptions[0].reviewDate = '2026-02-31'
  malformed.exceptions[0].patchedVersions = ['']
  const errors = compareAudit(report(), malformed, '2026-07-13').errors.join('\n')
  assert.match(errors, /reviewedAt must be an ISO date/)
  assert.match(errors, /nextReviewDate must be an ISO date/)
  assert.match(errors, /reviewDate must be an ISO date/)
  assert.match(errors, /patchedVersions must be an array of versions/)
})

test('auditSummaryLine produces the documentation contract', () => {
  const findings = [
    { classification: 'vulnerability' },
    { classification: 'vulnerability' },
    { classification: 'unsound' },
    { classification: 'unmaintained' },
  ]
  assert.equal(
    auditSummaryLine(findings),
    'A raw `cargo audit --json` run on 2026-07-13 reports 4 reviewed advisories: 2 vulnerabilities, 1 unsoundness warning, and 1 unmaintained warning.',
  )
})
