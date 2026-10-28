import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { installCargoAudit, readCargoAuditVersion } from './install-cargo-audit.mjs'

test('readCargoAuditVersion reads and validates the explicit tool pin', () => {
  assert.equal(readCargoAuditVersion({ cargoAudit: '0.22.2' }), '0.22.2')
  assert.throws(() => readCargoAuditVersion({}), /stable cargoAudit version/)
  assert.throws(() => readCargoAuditVersion({ cargoAudit: '0.23.0-beta.1' }), /stable cargoAudit version/)
})

test('the repository pins the reviewed cargo-audit version', () => {
  assert.equal(readCargoAuditVersion(), '0.22.2')
})

test('installCargoAudit reuses only the exact executable version', () => {
  const calls = []
  installCargoAudit('0.22.2', (command, args, options) => {
    calls.push({ command, args, options })
    return { status: 0, stdout: 'cargo-audit 0.22.2\n' }
  })
  assert.deepEqual(calls, [{ command: 'cargo-audit', args: ['--version'], options: { encoding: 'utf8' } }])
})

for (const probe of [{ error: new Error('missing'), status: null }, { status: 0, stdout: 'cargo-audit 0.22.1\n' }]) {
  test(`installCargoAudit replaces a ${probe.error ? 'missing' : 'stale'} executable with the exact pin`, () => {
    const calls = []
    installCargoAudit('0.22.2', (command, args, options) => {
      calls.push({ command, args, options })
      if (calls.length === 1) return probe
      return { status: 0, stdout: 'cargo-audit 0.22.2\n' }
    })
    assert.deepEqual(calls[1], {
      command: 'cargo', args: ['install', 'cargo-audit', '--locked', '--version', '=0.22.2', '--force'],
      options: { stdio: 'inherit' },
    })
    assert.equal(calls.length, 3, 'The installed executable must be verified after a cache miss')
  })
}

test('installCargoAudit rejects a failed install or incorrect resulting executable', () => {
  assert.throws(() => installCargoAudit('0.22.2', () => ({ status: 7 })), /status 7/)
  assert.throws(() => installCargoAudit('0.22.2', () => ({ status: 0, stdout: 'cargo-audit 0.22.1' })), /does not match pinned version/)
})

test('the shared CI and release gate installs cargo-audit through the pinned installer', () => {
  const action = readFileSync('.github/actions/validate-build/action.yml', 'utf8')
  const workflows = [
    readFileSync('.github/workflows/ci.yml', 'utf8'),
    readFileSync('.github/workflows/release.yml', 'utf8'),
  ]

  assert.match(action, /run: node scripts\/install-cargo-audit\.mjs/)
  for (const workflow of workflows) {
    assert.equal((workflow.match(/uses:\s*\$\/\.github\/actions\/validate-build/g) ?? []).length, 1)
  }
  for (const source of [action, ...workflows]) {
    assert.doesNotMatch(source, /cargo\s+install\s+cargo-audit\b/)
  }
})
