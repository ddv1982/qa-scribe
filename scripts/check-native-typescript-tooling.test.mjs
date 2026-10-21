import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { nativeLintCases } from './native-lint-coverage.mjs'
import { inspectFrontend, validateNativeTooling } from './check-native-typescript-tooling.mjs'

const frontend = new URL('../frontend/', import.meta.url)
const parity = JSON.parse(readFileSync(new URL('./fixtures/native-tooling/lint-parity.json', import.meta.url)))
const pins = { 'tsc-rs': '0.7.0', oxlint: '1.89.0', 'oxlint-tsgolint': '7.0.2004', json5: '2.2.3' }
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
    copyFileSync(new URL('../package.json', import.meta.url), join(project, 'package.json'))
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
  rejects(root, /Forbidden legacy dependency hidden -> npm:typescript@6\.0\.3/)
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
for (const range of ['>=4.8', '>=4.8.4 <6.1.0', '^7.0.0', '^6 || ^7']) {
  test(`runtime TypeScript peer ${range} is forbidden`, () => fixture(root => {
    json(join(root, 'node_modules/oxlint/package.json'), { name: 'oxlint', version: pins.oxlint, peerDependencies: { typescript: range } })
    const messages = findings(root).map(row => row.message).join('\n')
    assert.match(messages, /Forbidden legacy dependency typescript/)
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

for (const relative of ['scripts/probe.mjs', 'vite.config.ts']) {
  test(`maintained frontend runtime compiler import rejected in ${relative}`, () => fixture(root => {
    const file = join(root, relative)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, "import ts from 'typescript'")
    const failures = findings(root)
    assert.ok(failures.some(row => row.code === 'legacy-api-import' && row.location === `${file}:1` && row.message === 'Legacy compiler API import typescript'))
  }))
}

test('subdirectory-specific typed lint bypass is rejected from disk', () => fixture(root => {
  const file = join(root, '.oxlintrc.json')
  const config = JSON.parse(readFileSync(file))
  config.overrides.push({ files: ['src/app/**'], rules: { 'typescript/no-floating-promises': 'off' } })
  json(file, config)
  assert.ok(findings(root).some(row => row.code === 'lint-scope'))
}))
for (const files of [['src/**/*.ts'], ['**/*'], ['src/**/*.test.ts']]) {
  test(`changed override scope ${files.join(',')} is rejected`, () => fixture(root => {
    const config = JSON.parse(readFileSync(join(root, '.oxlintrc.json')))
    config.overrides[1].files = files
    json(join(root, '.oxlintrc.json'), config)
    assert.ok(findings(root).some(row => row.code === 'lint-scope'))
  }))
}
for (const [scope, name, replacement] of [
  ['frontend', 'check', 'bun run typecheck && bun run lint:css && bun run check:contrast'],
  ['frontend', 'check', 'bun run typecheck && bun run lint || true && bun run lint:css && bun run check:contrast'],
  ['root', 'verify', 'bun run frontend:compiler:check && bun run frontend:check'],
  ['root', 'verify:fast', 'bun run frontend:tooling:check || true && bun run frontend:compiler:check && bun run frontend:check'],
  ['root', 'verify', 'echo "noop && bun run frontend:tooling:check && bun run frontend:compiler:check && bun run frontend:check && done"'],
]) {
  test(`validation obligation ${scope}.${name} cannot be omitted or bypassed`, () => fixture(root => {
    const file = join(scope === 'root' ? dirname(root) : root, 'package.json')
    const manifest = JSON.parse(readFileSync(file))
    manifest.scripts[name] = replacement
    json(file, manifest)
    assert.ok(findings(root).some(row => row.code === 'command-obligation' && row.location === `${scope === 'root' ? 'root' : 'frontend'}.${name}`))
  }))
}
test('additional unconditional verification commands remain allowed', () => fixture(root => {
  const file = join(dirname(root), 'package.json')
  const manifest = JSON.parse(readFileSync(file))
  manifest.scripts.verify += ' && bun run additional:check'
  json(file, manifest)
  assert.deepEqual(findings(root), [])
}))
test('installed package distribution imports cannot hide under project exclusions', () => fixture(root => {
  const directory = join(root, 'node_modules/oxlint/dist')
  mkdirSync(directory)
  writeFileSync(join(directory, 'index.js'), "require('typescript')")
  assert.ok(findings(root).some(row => row.code === 'legacy-api-import' && row.location.endsWith('/oxlint/dist/index.js:1')))
}))

function coverageFixture(run) {
  const directory = new URL('./fixtures/native-tooling/', import.meta.url)
  const read = name => JSON.parse(readFileSync(new URL(name, directory)))
  run(read('typed-cases.json'), read('lint-cases.json'), read('lint-diagnostics.json'))
}
test('missing typed fixture cannot claim complete parity', () => coverageFixture((typed, additional, diagnostics) => {
  assert.throws(() => nativeLintCases(typed.filter(row => row.rule !== 'await-thenable'), additional, parity, diagnostics), /cover every parity rule exactly once/)
}))
test('duplicate typed fixture cannot claim complete parity', () => coverageFixture((typed, additional, diagnostics) => {
  assert.throws(() => nativeLintCases([...typed, typed[0]], additional, parity, diagnostics), /cover every parity rule exactly once/)
}))
test('missing valid typed source cannot claim complete parity', () => coverageFixture((typed, additional, diagnostics) => {
  delete typed[0].valid
  assert.throws(() => nativeLintCases(typed, additional, parity, diagnostics), /must have a valid fixture/)
}))
test('missing diagnostic expectations cannot claim complete parity', () => coverageFixture((typed, additional, diagnostics) => {
  delete diagnostics['await-thenable-invalid.ts']
  assert.throws(() => nativeLintCases(typed, additional, parity, diagnostics), /expectations must cover every fixture exactly once/)
}))
test('duplicate source filenames cannot claim complete parity', () => coverageFixture((typed, additional, diagnostics) => {
  additional.push(additional[0])
  assert.throws(() => nativeLintCases(typed, additional, parity, diagnostics), /Fixture filenames must be unique/)
}))

for (const [scope, name] of [['root', 'frontend:tooling:check'], ['root', 'frontend:compiler:check'], ['root', 'frontend:check'], ['frontend', 'lint:css'], ['frontend', 'check:contrast']]) {
  test(`validation dispatcher ${scope}.${name} must execute its real check`, () => fixture(root => {
    const file = join(scope === 'root' ? dirname(root) : root, 'package.json')
    const manifest = JSON.parse(readFileSync(file))
    manifest.scripts[name] = 'echo skipped'
    json(file, manifest)
    assert.ok(findings(root).some(row => row.code === 'command-obligation' && row.location === `${scope}.${name}`))
  }))
}

for (const relative of ['src/workflows/.oxlintrc.json', 'src/workflows/oxlint.config.js', 'vendor/.oxlintrc.jsonc', '.oxlintrc.yml']) {
  test(`additional Oxlint policy ${relative} is rejected without evaluation`, () => fixture(root => {
    const file = join(root, relative)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, relative.endsWith('.js') ? 'throw new Error("must never execute")' : '{"rules":{"typescript/no-floating-promises":"off"}}')
    const inventory = inspectFrontend(root)
    assert.ok(inventory.configFiles.includes(relative))
    assert.ok(validateNativeTooling(inventory, parity).some(row => row.code === 'lint-policy-config' && row.message.includes(relative)))
  }))
}
for (const source of [
  "import ts = require('typescript')",
  'void import(`typescript`)',
  "import { createRequire } from 'node:module'; createRequire(import.meta.url)('typescript')",
]) {
  test(`additional literal compiler API form is rejected: ${source}`, () => fixture(root => {
    writeFileSync(join(root, 'consumer.ts'), source)
    assert.ok(findings(root).some(row => row.code === 'legacy-api-import' && row.location.endsWith('/consumer.ts:1') && row.message === 'Legacy compiler API import typescript'))
  }))
}
test('type-only import-equals remains a non-runtime dependency', () => fixture(root => {
  writeFileSync(join(root, 'types.ts'), "import type ts = require('typescript'); export type Value = ts.Type")
  assert.deepEqual(findings(root), [])
}))

for (const name of ['typescript', '@typescript/native-preview', '@typescript/typescript-linux-x64', '@typescript/native-preview-darwin-arm64']) {
  for (const kind of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    test(`Microsoft SDK ${name} is forbidden in ${kind} including nested aliases`, () => fixture(root => {
      const directory = join(root, 'node_modules/oxlint/node_modules/nested')
      mkdirSync(directory, { recursive: true })
      json(join(directory, 'package.json'), { name: 'nested', version: '1.0.0', [kind]: { hidden: `npm:${name}@7.0.2` } })
      rejects(root, /Forbidden legacy dependency hidden/)
    }))
  }
  test(`Microsoft SDK locked identity ${name} is forbidden`, () => fixture((root, lock) => {
    lock.packages['nested/alias'] = [`${name}@7.0.2`, '', {}, 'sha512-fixture']
    json(join(root, 'bun.lock'), lock)
    rejects(root, /Forbidden legacy package/)
  }))
  test(`Microsoft SDK installed identity ${name} is forbidden`, () => fixture(root => {
    const directory = join(root, 'node_modules/alias'); mkdirSync(directory)
    json(join(directory, 'package.json'), { name, version: '7.0.2' })
    rejects(root, /Forbidden legacy package/)
  }))
}
test('an unrelated @typescript scoped package remains allowed', () => fixture(root => {
  const directory = join(root, 'node_modules/@typescript/support'); mkdirSync(directory, { recursive: true })
  json(join(directory, 'package.json'), { name: '@typescript/support', version: '1.0.0' })
  assert.deepEqual(findings(root), [])
}))
test('locked native Rust package must match the compiler pin', () => fixture((root, lock) => {
  lock.packages['@tsc-rs/linux-x64'] = ['@tsc-rs/linux-x64@0.6.0', '', {}, 'sha512-fixture']
  json(join(root, 'bun.lock'), lock)
  rejects(root, /Rust native package must match tsc-rs@0.7.0/)
}))
for (const name of ['postinstall', 'sdk:prepare']) {
  test(`SDK preparation dispatcher ${name} cannot be omitted`, () => fixture(root => {
    const file = join(root, 'package.json'); const manifest = JSON.parse(readFileSync(file)); delete manifest.scripts[name]; json(file, manifest)
    assert.ok(findings(root).some(row => row.code === 'command-obligation' && row.location === `frontend.${name}`))
  }))
}
