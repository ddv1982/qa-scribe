import assert from 'node:assert/strict'

export function nativeLintCases(typed, additional, parity, expectedDiagnostics) {
  const rules = parity.rules.filter(row => row.typeAware).map(row => row.native.replace('typescript/', '')).sort()
  assert.equal(new Set(rules).size, rules.length, 'Parity typed rule identities must be unique')
  assert.deepEqual(typed.map(row => row.rule).sort(), rules, 'Typed fixtures must cover every parity rule exactly once')
  for (const row of typed) {
    assert.equal(typeof row.valid, 'string', `${row.rule} must have a valid fixture`)
    assert.equal(typeof row.invalid, 'string', `${row.rule} must have an invalid fixture`)
    assert.ok(row.valid.trim() && row.invalid.trim() && row.valid !== row.invalid, `${row.rule} must have distinct nonempty valid and invalid fixtures`)
  }
  const cases = typed.flatMap(row => [
    { name: `${row.name}-invalid.ts`, source: row.invalid, rule: row.rule, severity: 'error' },
    { name: `${row.name}-valid.ts`, source: row.valid, rule: null },
  ])
  cases.push(...additional)
  for (const row of typed) {
    for (const suffix of ['test.ts', 'test.tsx', 'testHarness.ts', 'testSupport.ts']) {
      const disabled = suffix !== 'testSupport.ts' && parity.testDisabled.includes(`typescript/${row.rule}`)
      cases.push({ name: `${row.name}.${suffix}`, source: row.invalid, rule: disabled ? null : row.rule, severity: 'error', absentRule: disabled ? row.rule : null })
    }
  }
  assert.equal(new Set(cases.map(row => row.name)).size, cases.length, 'Fixture filenames must be unique')
  assert.deepEqual(Object.keys(expectedDiagnostics).sort(), cases.map(row => row.name).sort(), 'Diagnostic expectations must cover every fixture exactly once')
  for (const row of cases) {
    const expected = expectedDiagnostics[row.name]
    assert.ok(Array.isArray(expected), `${row.name} must have a diagnostic expectation array`)
    if (row.rule) assert.ok(expected.some(item => item.code?.endsWith(`(${row.rule})`) && item.severity === row.severity), `${row.name} must expect its named rule diagnostic`)
    if (row.name.endsWith('-valid.ts')) assert.deepEqual(expected, [], `${row.name} must expect clean valid behavior`)
  }
  return { cases, typedRuleCount: rules.length }
}
