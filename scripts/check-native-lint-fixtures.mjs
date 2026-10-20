import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtures = new URL('./fixtures/native-tooling/', import.meta.url)
const readFixture = name => JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'))

export function checkNativeLintFixtures(frontend) {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-native-lint-'))
  try {
    mkdirSync(join(root, 'src'))
    for (const file of ['.oxlintrc.json', 'tsconfig.json', 'tsconfig.node.json']) copyFileSync(join(frontend, file), join(root, file))
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    writeFileSync(join(root, 'vite.config.ts'), 'export const value = 1')
    symlinkSync(join(frontend, 'node_modules'), join(root, 'node_modules'), 'dir')
    const cases = readFixture('typed-cases.json').flatMap(row => [
      { name: `${row.name}-invalid.ts`, source: row.invalid, rule: row.rule, severity: 'error' },
      { name: `${row.name}-valid.ts`, source: row.valid, rule: null },
    ])
    cases.push(...readFixture('lint-cases.json'))
    const parity = readFixture('lint-parity.json')
    for (const row of readFixture('typed-cases.json')) {
      for (const suffix of ['test.ts', 'test.tsx', 'testHarness.ts', 'testSupport.ts']) {
        const disabled = suffix !== 'testSupport.ts' && parity.testDisabled.includes(`typescript/${row.rule}`)
        cases.push({ name: `${row.name}.${suffix}`, source: row.invalid, rule: disabled ? null : row.rule, severity: 'error', absentRule: disabled ? row.rule : null })
      }
    }
    for (const row of cases) writeFileSync(join(root, 'src', row.name), row.source)
    for (const ignored of ['dist', 'scripts']) {
      mkdirSync(join(root, ignored), { recursive: true })
      writeFileSync(join(root, ignored, 'invalid.ts'), 'Promise.resolve(1); export {}')
    }
    writeFileSync(join(root, 'vite.config.ts'), 'Promise.resolve(1); export {}')
    const expectedDiagnostics = readFixture('lint-diagnostics.json')
    const groups = [
      { name: 'clean', status: 0, accepts: rows => rows.length === 0 },
      { name: 'warnings', status: 0, accepts: rows => rows.length > 0 && rows.every(row => row.severity === 'warning') },
      { name: 'errors', status: 1, accepts: rows => rows.some(row => row.severity === 'error') },
    ]
    const collected = []
    for (const group of groups) {
      const selected = cases.filter(row => group.accepts(expectedDiagnostics[row.name]))
      assert.ok(selected.length > 0, `${group.name} fixture group must execute`)
      const result = spawnSync(join(frontend, 'node_modules/.bin/oxlint'), [
        '--type-aware', '--report-unused-disable-directives-severity', 'error', '--format', 'json', ...selected.map(row => `src/${row.name}`),
      ], { cwd: root, encoding: 'utf8', timeout: 90_000 })
      assert.ifError(result.error)
      assert.equal(result.status, group.status, `${group.name} fixtures must exit ${group.status}: ${result.stderr}\n${result.stdout}`)
      collected.push(...JSON.parse(result.stdout).diagnostics)
    }
    const result = spawnSync(join(frontend, 'node_modules/.bin/oxlint'), ['--type-aware', '--format', 'json', 'vite.config.ts', 'dist', 'scripts'], { cwd: root, encoding: 'utf8', timeout: 30_000 })
    assert.equal(result.status, 1, 'Typed Vite fixture must fail while ignored files stay ignored')
    collected.push(...JSON.parse(result.stdout).diagnostics)
    const report = { diagnostics: collected }
    const receipts = []
    for (const row of cases) {
      const diagnostics = report.diagnostics.filter(item => item.filename === `src/${row.name}`)
      receipts.push({ name: row.name, diagnostics: diagnostics.map(item => ({code: item.code ?? null, severity: item.severity, spans: item.labels.map(label => label.span)})).sort((a, b) => String(a.code).localeCompare(String(b.code)) || a.spans[0].offset - b.spans[0].offset) })
      assert.deepEqual(receipts.at(-1).diagnostics, expectedDiagnostics[row.name], `${row.name} must preserve exact diagnostic identity, severity, and ranges`)
      if (row.parserMessage) {
        assert.ok(diagnostics.some(item => !item.code && item.message === row.parserMessage && item.severity === 'error'), `${row.name} must reject strict-mode syntax`)
      } else if (row.rule) {
        const diagnostic = diagnostics.find(item => item.code?.endsWith(`(${row.rule})`) || item.code === row.rule)
        assert.ok(diagnostic, `${row.name} must report ${row.rule}\n${JSON.stringify(diagnostics)}`)
        assert.equal(diagnostic.severity, row.severity, row.name)
      } else if (row.absentRule) {
        assert.ok(!diagnostics.some(item => item.code?.endsWith(`(${row.absentRule})`)), `${row.name} must relax only ${row.absentRule}`)
      } else {
        assert.deepEqual(diagnostics, [], `${row.name} must be clean`)
      }
    }
    assert.ok(report.diagnostics.some(item => item.filename === 'vite.config.ts' && item.code === 'typescript(no-floating-promises)'), 'Vite configuration must retain typed lint')
    assert.ok(!report.diagnostics.some(item => item.filename.startsWith('dist/') || item.filename.startsWith('scripts/')), 'Ignored build output and scripts must remain ignored')
    console.log(`PASS ${cases.length} native lint behavior fixtures, including all 23 typed rules and test scopes`)
    return { cases: cases.length, diagnostics: report.diagnostics.length, receipts }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkNativeLintFixtures(fileURLToPath(new URL('../frontend/', import.meta.url)))
}
