import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectCodeSize, physicalLineCount } from './check-code-size.mjs'

const policy = { maxLines: 500, watchLines: 300, exceptions: [], excludedFiles: [] }

test('physicalLineCount handles final newlines without inventing a line', () => {
  assert.equal(physicalLineCount('one\ntwo\n'), 2)
  assert.equal(physicalLineCount('one\ntwo'), 2)
  assert.equal(physicalLineCount(''), 0)
})

test('inspectCodeSize reports watch files and fails unapproved oversized files', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-code-size-'))
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/watch.ts'), 'line\n'.repeat(300))
    writeFileSync(join(root, 'src/oversized.ts'), 'line\n'.repeat(501))

    const result = inspectCodeSize(root, policy, '2026-07-13')
    assert.deepEqual(result.watched, [{ path: 'src/watch.ts', lineCount: 300 }])
    assert.deepEqual(result.failures, [{ path: 'src/oversized.ts', lineCount: 501, reason: 'no approved exception' }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('inspectCodeSize accepts a current exception and rejects it after review date', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-code-size-'))
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/cohesive.rs'), 'line\n'.repeat(501))
    const exceptionPolicy = {
      ...policy,
      exceptions: [{ path: 'src/cohesive.rs', reviewDate: '2026-10-13', reason: 'Cohesive parser.', splitCost: 'Shared state would become less clear.', reviewTrigger: 'Parser redesign.' }],
    }

    assert.equal(inspectCodeSize(root, exceptionPolicy, '2026-07-13').failures.length, 0)
    assert.equal(inspectCodeSize(root, exceptionPolicy, '2026-10-14').failures[0]?.reason, 'exception expired 2026-10-13')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('inspectCodeSize validates exclusion metadata and review dates', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-code-size-'))
  try {
    mkdirSync(join(root, 'scripts'))
    writeFileSync(join(root, 'scripts/packaging.py'), 'line\n'.repeat(501))
    const exclusion = {
      path: 'scripts/packaging.py',
      reason: 'One packaging command.',
      splitCost: 'A split would duplicate the reporting contract.',
      reviewDate: '2026-10-13',
      reviewTrigger: 'Packaging responsibilities change.',
    }

    assert.equal(inspectCodeSize(root, { ...policy, excludedFiles: [exclusion] }, '2026-07-13').failures.length, 0)
    assert.equal(
      inspectCodeSize(root, { ...policy, excludedFiles: [{ ...exclusion, splitCost: '' }] }, '2026-07-13').failures[0]?.reason,
      'exclusion is missing splitCost',
    )
    assert.equal(
      inspectCodeSize(root, { ...policy, excludedFiles: [exclusion] }, '2026-10-14').failures[0]?.reason,
      'exclusion expired 2026-10-13',
    )
    assert.equal(
      inspectCodeSize(root, { ...policy, excludedFiles: [{ ...exclusion, reviewDate: '2026-02-31' }] }, '2026-07-13').failures[0]?.reason,
      'exclusion has invalid reviewDate',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
