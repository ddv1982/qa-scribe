import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectLintSelection, validateLintSelection } from './native-tooling-selection.mjs'

const command = 'oxlint --type-aware --report-unused-disable-directives-severity error .'
const ignored = ['dist', 'node_modules', 'scripts']
function fixture(run) {
  const project = mkdtempSync(join(tmpdir(), 'qa-native-selection-'))
  const frontend = join(project, 'frontend')
  mkdirSync(join(frontend, 'src'), { recursive: true })
  copyFileSync(new URL('../frontend/.oxlintrc.json', import.meta.url), join(frontend, '.oxlintrc.json'))
  symlinkSync(new URL('../frontend/node_modules', import.meta.url).pathname, join(frontend, 'node_modules'), 'dir')
  writeFileSync(join(frontend, 'src/probe.ts'), 'void Promise.resolve(1); export {}')
  writeFileSync(join(frontend, 'vite.config.ts'), 'export const value = 1')
  for (const directory of ['scripts', 'dist', 'src/scripts', 'src/dist']) {
    mkdirSync(join(frontend, directory), { recursive: true })
    writeFileSync(join(frontend, directory, 'ignored.ts'), 'Promise.resolve(1); export {}')
  }
  try { run(frontend, project) } finally { rmSync(project, { recursive: true, force: true }) }
}
const selection = frontend => inspectLintSelection(frontend, command, ignored)
const requireMissingProbe = (frontend, env) => {
  const result = env ? inspectLintSelection(frontend, command, ignored, env) : selection(frontend)
  assert.ok(result.expected.includes('src/probe.ts'), 'Filesystem source inventory must retain the ignored source')
  assert.ok(!result.selected.includes('src/probe.ts'), 'The actual native command must demonstrate the exclusion')
  assert.deepEqual(validateLintSelection(result), [{ code: 'lint-file-coverage', location: 'src/probe.ts', message: 'Maintained source is excluded from the actual Oxlint command' }])
}

test('actual native selection covers maintained files and canonical exclusions', () => fixture(frontend => {
  const result = selection(frontend)
  assert.deepEqual(result.expected, ['src/probe.ts', 'vite.config.ts'])
  assert.deepEqual(result.selected, result.expected)
  assert.deepEqual(validateLintSelection(result), [])
}))
for (const [file, contents] of [['.eslintignore', 'src/probe.ts\n'], ['.gitignore', 'src/probe.ts\n'], ['src/.gitignore', 'probe.ts\n']]) {
  test(`${file} cannot silently remove a maintained source`, () => fixture(frontend => {
    writeFileSync(join(frontend, file), contents)
    requireMissingProbe(frontend)
  }))
}
test('a project-root gitignore cannot hide a tracked maintained source', () => fixture((frontend, project) => {
  const initialized = spawnSync('git', ['init', '-q', project], { encoding: 'utf8' })
  assert.equal(initialized.status, 0, initialized.stderr)
  const tracked = spawnSync('git', ['-C', project, 'add', 'frontend/src/probe.ts'], { encoding: 'utf8' })
  assert.equal(tracked.status, 0, tracked.stderr)
  writeFileSync(join(project, '.gitignore'), 'frontend/src/probe.ts\n')
  requireMissingProbe(frontend)
}))
test('ignore metadata restricted to canonical exclusions remains permitted', () => fixture(frontend => {
  writeFileSync(join(frontend, '.eslintignore'), 'scripts/\ndist/\n')
  writeFileSync(join(frontend, '.gitignore'), 'scripts/\ndist/\n')
  assert.deepEqual(validateLintSelection(selection(frontend)), [])
}))
test('untracked and declaration sources remain required by filesystem selection', () => fixture(frontend => {
  writeFileSync(join(frontend, 'src/untracked.ts'), 'export const value = 1')
  writeFileSync(join(frontend, 'src/ambient.d.ts'), 'export declare const value: number')
  const result = selection(frontend)
  assert.ok(result.expected.includes('src/untracked.ts'))
  assert.ok(result.expected.includes('src/ambient.d.ts'))
  assert.deepEqual(validateLintSelection(result), [])
}))

test('global ignore metadata does not weaken the maintained-source requirement', () => fixture((frontend, project) => {
  const initialized = spawnSync('git', ['init', '-q', project], { encoding: 'utf8' })
  assert.equal(initialized.status, 0, initialized.stderr)
  const config = join(project, 'xdg-config')
  mkdirSync(join(config, 'git'), { recursive: true })
  writeFileSync(join(config, 'git/ignore'), 'probe.ts\n')
  const globalConfig = join(project, 'git-global.config')
  writeFileSync(globalConfig, `[core]\n  excludesFile = ${join(config, 'git/ignore')}\n`)
  for (const env of [{ ...process.env, XDG_CONFIG_HOME: config }, { ...process.env, GIT_CONFIG_GLOBAL: globalConfig }]) {
    const result = inspectLintSelection(frontend, command, ignored, env)
    assert.deepEqual(result.expected, ['src/probe.ts', 'vite.config.ts'])
    assert.ok(result.selected.includes('vite.config.ts'))
    const missing = result.selected.includes('src/probe.ts') ? [] : [{ code: 'lint-file-coverage', location: 'src/probe.ts', message: 'Maintained source is excluded from the actual Oxlint command' }]
    assert.deepEqual(validateLintSelection(result), missing)
  }
}))
