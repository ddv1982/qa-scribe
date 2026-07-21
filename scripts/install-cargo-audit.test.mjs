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

test('installCargoAudit invokes cargo install with the exact tool pin', () => {
  let invocation
  installCargoAudit('0.22.2', (command, args, options) => {
    invocation = { command, args, options }
    return { status: 0 }
  })

  assert.deepEqual(invocation, {
    command: 'cargo',
    args: ['install', 'cargo-audit', '--locked', '--version', '=0.22.2'],
    options: { stdio: 'inherit' },
  })
})

test('installCargoAudit rejects a failed cargo install process', () => {
  assert.throws(() => installCargoAudit('0.22.2', () => ({ status: 7 })), /status 7/)
})

test('the shared CI and release gate installs cargo-audit through the pinned installer', () => {
  const action = readFileSync('.github/actions/validate-build/action.yml', 'utf8')
  const workflows = [
    readFileSync('.github/workflows/ci.yml', 'utf8'),
    readFileSync('.github/workflows/release.yml', 'utf8'),
  ]

  assert.match(action, /run: node scripts\/install-cargo-audit\.mjs/)
  for (const workflow of workflows) {
    assert.equal((workflow.match(/uses:\s*\.\/\.github\/actions\/validate-build/g) ?? []).length, 1)
  }
  for (const source of [action, ...workflows]) {
    assert.doesNotMatch(source, /cargo\s+install\s+cargo-audit\b/)
  }
})
