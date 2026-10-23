import assert from 'node:assert/strict'
import test from 'node:test'
import { auditFindings, auditSummaryLine, compareAudit } from './check-rust-audit.mjs'

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
    auditSummaryLine(findings, '2026-07-13'),
    'A raw `cargo audit --json` run on 2026-07-13 reports 4 reviewed advisories: 2 vulnerabilities, 1 unsoundness warning, and 1 unmaintained warning.',
  )
})

const yankedWarning = {
  "kind": "yanked",
  "package": {
    "name": "clipboard-win",
    "version": "5.4.1",
    "source": "registry+https://github.com/rust-lang/crates.io-index",
    "checksum": "bde03770d3df201d4fb868f2c9c59e66a3e4e2bd06692a0fe701e7103c7e84d4",
    "dependencies": [
      {
        "name": "error-code",
        "version": "3.3.2",
        "source": "registry+https://github.com/rust-lang/crates.io-index"
      }
    ],
    "replace": null
  },
  "advisory": null,
  "affected": null,
  "versions": null
}

function yankedReport() {
  return { ...report(), warnings: { yanked: [structuredClone(yankedWarning)] } }
}

function yankedRegistry() {
  const reviewed = registry()
  reviewed.exceptions.push({ ...reviewed.exceptions[0], id: 'yanked:clipboard-win',
    classification: 'yanked', package: 'clipboard-win', version: '5.4.1' })
  return reviewed
}

test('an actual advisory-free yanked warning fails with its kind, package and version', () => {
  const result = compareAudit(yankedReport(), registry(), '2026-07-13')
  assert.deepEqual(result.errors, ['yanked:clipboard-win: new yanked in clipboard-win 5.4.1'])
  assert.deepEqual(result.findings.find(({ id }) => id === 'yanked:clipboard-win'), {
    id: 'yanked:clipboard-win', classification: 'yanked', package: 'clipboard-win', version: '5.4.1',
  })
})

test('advisory-backed vulnerability, unsound and unmaintained identities retain exact checks', () => {
  const input = report()
  const reviewed = registry()
  for (const kind of ['unsound', 'unmaintained']) {
    const id = `RUSTSEC-${kind}`
    input.warnings[kind] = [{ kind, advisory: { id, informational: kind }, package: { name: kind, version: '1.0.0' } }]
    reviewed.exceptions.push({ ...reviewed.exceptions[0], id, classification: kind, package: kind })
  }
  assert.deepEqual(auditFindings(input), [
    { id: 'RUSTSEC-2026-0001', classification: 'vulnerability', package: 'example', version: '1.0.0' },
    { id: 'RUSTSEC-unmaintained', classification: 'unmaintained', package: 'unmaintained', version: '1.0.0' },
    { id: 'RUSTSEC-unsound', classification: 'unsound', package: 'unsound', version: '1.0.0' },
  ])
  assert.deepEqual(compareAudit(input, reviewed, '2026-07-13').errors, [])
  input.warnings.unsound[0].package.version = '1.0.1'
  assert.deepEqual(compareAudit(input, reviewed, '2026-07-13').errors,
    ['RUSTSEC-unsound: registry version 1.0.0 does not match audit 1.0.1'])
})

test('package-scoped warning identities cannot bypass registered metadata or stale checks', () => {
  assert.deepEqual(compareAudit(yankedReport(), yankedRegistry(), '2026-07-13').errors, [])
  for (const [field, value, expected] of [
    ['classification', 'unmaintained', 'yanked:clipboard-win: registry classification unmaintained does not match audit yanked'],
    ['package', 'other', 'yanked:clipboard-win: registry package other does not match audit clipboard-win'],
    ['version', '5.4.3', 'yanked:clipboard-win: registry version 5.4.3 does not match audit 5.4.1'],
  ]) {
    const reviewed = yankedRegistry()
    reviewed.exceptions[1][field] = value
    assert.deepEqual(compareAudit(yankedReport(), reviewed, '2026-07-13').errors, [expected])
  }
  const upgraded = yankedReport()
  upgraded.warnings.yanked[0].package.version = '5.4.3'
  assert.deepEqual(compareAudit(upgraded, yankedRegistry(), '2026-07-13').errors,
    ['yanked:clipboard-win: registry version 5.4.1 does not match audit 5.4.3'])
  const renamed = yankedReport()
  renamed.warnings.yanked[0].package.name = 'other'
  assert.deepEqual(compareAudit(renamed, yankedRegistry(), '2026-07-13').errors, [
    'yanked:other: new yanked in other 5.4.1',
    'yanked:clipboard-win: registry entry is stale because cargo-audit no longer reports it',
  ])
  assert.deepEqual(compareAudit(report(), yankedRegistry(), '2026-07-13').errors,
    ['yanked:clipboard-win: registry entry is stale because cargo-audit no longer reports it'])
})

test('unknown advisory-free warning kinds remain actionable findings', () => {
  const input = report()
  input.warnings = { future: [{ ...structuredClone(yankedWarning), kind: 'future' }] }
  assert.deepEqual(compareAudit(input, registry(), '2026-07-13').errors,
    ['future:clipboard-win: new future in clipboard-win 5.4.1'])
})

test('malformed warnings fail closed with field-specific diagnostics', () => {
  const mutations = [
    [input => { input.warnings = null }, 'warnings must be an object'],
    [input => { input.warnings = [] }, 'warnings must be an object'],
    [input => { input.warnings.yanked = {} }, 'warnings.yanked must be an array'],
    [input => { input.warnings.yanked[0] = null }, 'warning yanked[0] must be an object'],
    [input => { delete input.warnings.yanked[0].kind }, 'warning yanked[0] kind must match its group'],
    [input => { input.warnings.yanked[0].kind = 'unsound' }, 'warning yanked[0] kind must match its group'],
    [input => { input.warnings.yanked[0].package = null }, 'warning yanked[0] requires package name and version'],
    [input => { input.warnings.yanked[0].package.name = '' }, 'warning yanked[0] requires package name and version'],
    [input => { input.warnings.yanked[0].package.version = 5 }, 'warning yanked[0] requires package name and version'],
    [input => { delete input.warnings.yanked[0].advisory }, 'warning yanked[0] advisory must be null or contain an id'],
    [input => { input.warnings.yanked[0].advisory = {} }, 'warning yanked[0] advisory must be null or contain an id'],
    [input => { input.warnings.yanked[0].advisory = { id: 'RUSTSEC-TEST', informational: 7 } }, 'warning yanked[0] advisory informational must be text'],
  ]
  for (const [mutate, expected] of mutations) {
    const input = yankedReport()
    mutate(input)
    const result = compareAudit(input, registry(), '2026-07-13')
    assert.deepEqual(result.errors, [`Invalid cargo-audit report: ${expected}`])
    assert.deepEqual(result.findings, [])
  }
})
