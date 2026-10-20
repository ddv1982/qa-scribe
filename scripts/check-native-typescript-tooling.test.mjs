import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { inspectFrontend, validateNativeTooling } from './check-native-typescript-tooling.mjs'

const frontend = new URL('../frontend/', import.meta.url)
const parity = JSON.parse(readFileSync(new URL('./fixtures/native-tooling/lint-parity.json', import.meta.url)))
const pins = { typescript: '7.0.2', 'tsc-rs': '0.7.0', oxlint: '1.89.0', 'oxlint-tsgolint': '7.0.2004', json5: '2.2.3' }
const json = (file, value) => writeFileSync(file, JSON.stringify(value))

function fixture(run) {
  const project = mkdtempSync(join(tmpdir(), 'qa-native-metadata-'))
  const root = join(project, 'frontend')
  mkdirSync(root)
  try {
    const manifest = JSON.parse(readFileSync(new URL('package.json', frontend)))
    manifest.dependencies = {}
    manifest.devDependencies = pins
    const lock = { lockfileVersion: 1, workspaces: { '': manifest }, packages: {} }
    for (const [name, version] of Object.entries(pins)) {
      const directory = join(root, 'node_modules', name)
      mkdirSync(directory, { recursive: true })
      if (name === 'json5') {
        symlinkSync(new URL('../frontend/node_modules/json5/lib', import.meta.url).pathname, join(directory, 'lib'), 'dir')
        json(join(directory, 'package.json'), { name, version, main: 'lib/index.js' })
      } else json(join(directory, 'package.json'), { name, version })
      lock.packages[name] = [`${name}@${version}`, '', {}, 'sha512-fixture']
    }
    json(join(root, 'package.json'), manifest)
    json(join(root, 'bun.lock'), lock)
    copyFileSync(new URL('.oxlintrc.json', frontend), join(root, '.oxlintrc.json'))
    run(root, lock)
  } finally { rmSync(project, { recursive: true, force: true }) }
}
const findings = root => validateNativeTooling(inspectFrontend(root), parity)
const rejects = (root, pattern) => assert.match(findings(root).map(row => row.message).join('\n'), pattern)

test('native metadata is accepted without installing or executing a compiler', () => fixture(root => assert.deepEqual(findings(root), [])))
test('optional lock-only TypeScript 6 is rejected by canonical identity', () => fixture((root, lock) => {
  lock.packages['hidden/alias'] = ['typescript@6.0.3', '', {}, 'sha512-fixture']
  json(join(root, 'bun.lock'), lock)
  rejects(root, /typescript@6\.0\.3/)
}))
test('nested npm alias declaration is rejected', () => fixture(root => {
  const directory = join(root, 'node_modules/oxlint/node_modules/nested')
  mkdirSync(directory, { recursive: true })
  json(join(directory, 'package.json'), { name: 'nested', version: '1.0.0', optionalDependencies: { hidden: 'npm:typescript@6.0.3' } })
  rejects(root, /hidden requires TypeScript range 6\.0\.3/)
}))
for (const name of ['@typescript/typescript6', '@typescript-eslint/parser', 'typescript-eslint', 'ts-api-utils']) {
  test(`extraneous installed ${name} is rejected`, () => fixture(root => {
    const directory = join(root, 'node_modules/extraneous')
    mkdirSync(directory)
    json(join(directory, 'package.json'), { name, version: '6.0.3' })
    rejects(root, /Forbidden legacy package/)
  }))
}
test('legacy compiler API metadata is rejected', () => fixture(root => {
  json(join(root, 'node_modules/oxlint/package.json'), { name: 'oxlint', version: pins.oxlint, imports: { '#compiler': 'typescript/lib/typescript.js' } })
  rejects(root, /Legacy compiler API/)
}))
for (const [range, accepted] of [['>=4.8', true], ['>=4.8.4 <6.1.0', false], ['^7.0.0', true], ['^6 || ^7', true]]) {
  test(`runtime TypeScript peer ${range} accepted=${accepted}`, () => fixture(root => {
    json(join(root, 'node_modules/oxlint/package.json'), { name: 'oxlint', version: pins.oxlint, peerDependencies: { typescript: range } })
    const messages = findings(root).map(row => row.message).join('\n')
    if (accepted) assert.equal(messages, '')
    else assert.match(messages, /excluding installed 7\.0\.2/)
  }))
}
test('uninstalled upstream development dependencies are outside runtime graph', () => fixture(root => {
  json(join(root, 'node_modules/oxlint/package.json'), { name: 'oxlint', version: pins.oxlint, devDependencies: { hidden: 'npm:typescript@6.0.3' } })
  assert.deepEqual(findings(root), [])
}))
test('malformed lock tuples fail closed', () => fixture((root, lock) => {
  lock.packages.invalid = ['typescript@6.0.3']
  json(join(root, 'bun.lock'), lock)
  assert.throws(() => inspectFrontend(root), /Malformed lock tuple/)
}))
test('broken package symlinks fail closed', () => fixture(root => {
  symlinkSync(join(root, 'missing'), join(root, 'node_modules/broken'))
  assert.throws(() => inspectFrontend(root), /ENOENT/)
}))
test('symlink cycles terminate while preserving installed identities', () => fixture(root => {
  const directory = join(root, 'node_modules/oxlint/node_modules')
  mkdirSync(directory)
  symlinkSync(join(root, 'node_modules/oxlint'), join(directory, 'cycle'), 'dir')
  assert.deepEqual(findings(root), [])
}))
for (const [label, mutate, expected] of [
  ['lost typed rule', x => { delete x.config.rules['typescript/no-floating-promises'] }, /no-floating-promises/],
  ['lost type-aware mode', x => { x.config.options.typeAware = false }, /type-aware engine/],
  ['unsafe test member override', x => { x.config.overrides[2].rules['typescript/no-unsafe-member-access'] = 'off' }, /no-unsafe-member-access/],
  ['lost underscore option', x => { x.config.overrides[1].rules['no-unused-vars'][1].argsIgnorePattern = '^ignored' }, /no-unused-vars/],
  ['omitted config checker', x => { x.manifest.scripts.typecheck = 'tsc-rs --noEmit -p tsconfig.json' }, /tsconfig.node.json/],
  ['missing native engine', x => { delete x.manifest.devDependencies['oxlint-tsgolint'] }, /oxlint-tsgolint/],
]) {
  test(label, () => fixture(root => {
    const inventory = inspectFrontend(root)
    mutate(inventory)
    assert.match(validateNativeTooling(inventory, parity).map(row => `${row.location} ${row.message}`).join('\n'), expected)
  }))
}

for (const source of ["import ts from 'typescript'", "import 'typescript/lib/typescript.js'", "require('typescript/lib/tsserverlibrary')", "void import('typescript')"]) {
  test(`runtime compiler API import rejected: ${source}`, () => fixture(root => {
    writeFileSync(join(root, 'node_modules/oxlint/consumer.js'), source)
    rejects(root, /Legacy compiler API import/)
  }))
}
test('type-only compiler imports and inert examples are not executed dependencies', () => fixture(root => {
  writeFileSync(join(root, 'node_modules/oxlint/types.ts'), "import type {Type} from 'typescript'; export type Value=Type; export { type Other } from 'typescript'")
  writeFileSync(join(root, 'node_modules/oxlint/examples.js'), ['// require("typescript")', `export const example=${JSON.stringify("import ts from 'typescript'")}`].join('\n'))
  assert.deepEqual(findings(root), [])
}))
for (const command of [
  'tsc-rs --noEmit -p tsconfig.json || true && tsc-rs --noEmit -p tsconfig.node.json',
  'tsc-rs -p tsconfig.json && tsc-rs --noEmit -p tsconfig.node.json',
  'tsc-rs --noEmit -p tsconfig.json; true && tsc-rs --noEmit -p tsconfig.node.json',
]) {
  test(`compiler bypass rejected: ${command}`, () => fixture(root => {
    const inventory = inspectFrontend(root)
    inventory.manifest.scripts.typecheck = command
    assert.ok(validateNativeTooling(inventory, parity).some(row => row.code === 'compiler-ownership'))
  }))
}

test('maintained script compiler API imports are rejected by source location', () => fixture(root => {
  const directory = join(dirname(root), 'scripts')
  mkdirSync(directory)
  writeFileSync(join(directory, 'consumer.mjs'), "import ts from 'typescript'")
  const failures = findings(root)
  assert.ok(failures.some(row => row.code === 'legacy-api-import' && row.location.endsWith('/scripts/consumer.mjs:1') && row.message === 'Legacy compiler API import typescript'))
}))
test('maintained script type-only reexports remain non-runtime', () => fixture(root => {
  const directory = join(dirname(root), 'scripts')
  mkdirSync(directory)
  writeFileSync(join(directory, 'types.ts'), "export { type Type } from 'typescript'")
  assert.deepEqual(findings(root), [])
}))
