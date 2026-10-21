import assert from 'node:assert/strict'
import { chmodSync, readlinkSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { prepareRustSdk } from './prepare-rust-typescript-sdk.mjs'
import { inspectEditorTooling, validateEditorTooling } from './native-tooling-editor.mjs'

const layouts = JSON.parse(readFileSync(new URL('./fixtures/native-tooling/editor-layouts.json', import.meta.url), 'utf8'))
const write = (root, file, value) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value))
}
const edit = (root, file, change) => {
  const value = JSON.parse(readFileSync(join(root, file), 'utf8'))
  change(value)
  write(root, file, value)
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'native-editor-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const root = join(directory, 'checkout')
  for (const [name, settings] of Object.entries(layouts)) {
    const folder = name === 'root' ? '' : 'frontend/'
    write(root, `${folder}.vscode/settings.json`, settings)
    write(root, `${folder}.vscode/extensions.json`, { recommendations: ['TypeScriptTeam.native-preview', 'oxc.oxc-vscode'] })
  }
  const pins = { 'tsc-rs': '0.7.0', oxlint: '1.89.0', 'oxlint-tsgolint': '7.0.2004' }
  write(root, 'frontend/package.json', { devDependencies: pins })
  for (const [name, bin] of [['oxlint', { oxlint: './bin/oxlint' }], ['oxlint-tsgolint', { tsgolint: './bin/tsgolint.js' }]]) {
    write(root, `frontend/node_modules/${name}/package.json`, { name, version: pins[name], bin })
    write(root, `frontend/node_modules/${name}/${Object.values(bin)[0]}`, 'metadata fixture only')
  }
  const native = `@tsc-rs/${process.platform}-${process.arch}`
  write(root, 'frontend/node_modules/tsc-rs/package.json', { name: 'tsc-rs', version: pins['tsc-rs'], optionalDependencies: { [native]: pins['tsc-rs'] } })
  write(root, `frontend/node_modules/${native}/package.json`, { name: native, version: pins['tsc-rs'], os: [process.platform], cpu: [process.arch] })
  write(root, `frontend/node_modules/${native}/lib/tsc`, 'metadata fixture only')
  chmodSync(join(root, `frontend/node_modules/${native}/lib/tsc`), 0o755)
  for (const file of ['lib.d.ts', 'lib.es5.d.ts', 'lib.dom.d.ts', 'lib.esnext.full.d.ts']) write(root, `frontend/node_modules/${native}/lib/${file}`, 'metadata fixture only')
  prepareRustSdk(join(root, 'frontend'))
  write(root, 'frontend/.oxlintrc.json', { options: { typeAware: true } })
  write(root, 'frontend/tsconfig.json', { include: ['src'], references: [{ path: './tsconfig.node.json' }] })
  write(root, 'frontend/tsconfig.node.json', { include: ['vite.config.ts'] })
  return root
}

test('portable paired layouts survive checkout relocation and JSONC', t => {
  const root = fixture(t)
  const relocated = `${root}-relocated`
  renameSync(root, relocated)
  write(relocated, 'frontend/tsconfig.node.json', '{ // node project\n include: ["vite.config.ts"], }')
  assert.deepEqual(validateEditorTooling(inspectEditorTooling(relocated)), [])
})

const mutations = [
  ['missing SDK', 'editor-sdk', root => edit(root, '.vscode/settings.json', s => { s['js/ts.tsdk.path'] = './node_modules/.tsc-rs-sdk' })],
  ['off by one frontend SDK', 'editor-sdk', root => edit(root, 'frontend/.vscode/settings.json', s => { s['js/ts.tsdk.path'] = './frontend/node_modules/.tsc-rs-sdk' })],
  ['missing Oxlint bin', 'editor-oxlint', root => rmSync(join(root, 'frontend/node_modules/oxlint/bin/oxlint'))],
  ['wrong SDK identity', 'editor-sdk', root => edit(root, 'frontend/node_modules/tsc-rs/package.json', p => { p.name = 'unrelated' })],
  ['wrong SDK pin', 'editor-sdk', root => edit(root, 'frontend/node_modules/tsc-rs/package.json', p => { p.version = '0.6.0' })],
  ['wrong typed engine pin', 'editor-package', root => edit(root, 'frontend/node_modules/oxlint-tsgolint/package.json', p => { p.version = '7.0.2003' })],
  ['missing declared launcher', 'editor-package-bin', root => edit(root, 'frontend/node_modules/oxlint/package.json', p => { delete p.bin })],
  ['wrong lint config', 'editor-lint-config', root => edit(root, '.vscode/settings.json', s => { s['oxc.configPath'] = './.oxlintrc.json' })],
  ['disabled TypeScript 7 client', 'editor-provider', root => edit(root, '.vscode/settings.json', s => { s['js/ts.experimental.useTsgo'] = false })],
  ['disabled typed lint', 'editor-typed-lint', root => edit(root, 'frontend/.vscode/settings.json', s => { s['oxc.typeAware'] = false })],
  ['untyped canonical config', 'editor-typed-lint', root => edit(root, 'frontend/.oxlintrc.json', c => { c.options.typeAware = false })],
  ['forced UI project', 'editor-project-scope', root => edit(root, '.vscode/settings.json', s => { s['oxc.tsConfigPath'] = './frontend/tsconfig.json' })],
  ['missing node reference', 'editor-project-scope', root => edit(root, 'frontend/tsconfig.json', c => { delete c.references })],
  ['lost Vite membership', 'editor-project-scope', root => edit(root, 'frontend/tsconfig.node.json', c => { c.include = ['scripts'] })],
  ['excluded Vite membership', 'editor-project-scope', root => edit(root, 'frontend/tsconfig.node.json', c => { c.exclude = ['vite.config.ts'] })],
  ['missing extension', 'editor-extension', root => edit(root, 'frontend/.vscode/extensions.json', e => { e.recommendations = ['oxc.oxc-vscode'] })],
  ['string recommendations', 'editor-extension', root => edit(root, '.vscode/extensions.json', e => { e.recommendations = 'TypeScriptTeam.native-preview,oxc.oxc-vscode' })],
  ['invalid extension identifier', 'editor-extension', root => edit(root, '.vscode/extensions.json', e => { e.recommendations.push('invalid extension') })],
  ['unconfigured typed engine', 'editor-tsgolint', root => edit(root, '.vscode/settings.json', s => { delete s['oxc.path.tsgolint'] })],
  ['wrong typed engine launcher', 'editor-tsgolint', root => edit(root, '.vscode/settings.json', s => { s['oxc.path.tsgolint'] = './frontend/node_modules/oxlint/bin/oxlint' })],
  ['launcher escaping its package', 'editor-package-bin', root => {
    write(root, 'frontend/foreign-bin', 'metadata fixture only')
    rmSync(join(root, 'frontend/node_modules/oxlint/bin/oxlint'))
    symlinkSync(join(root, 'frontend/foreign-bin'), join(root, 'frontend/node_modules/oxlint/bin/oxlint'))
  }],
]
for (const [name, code, mutate] of mutations) {
  test(`rejects ${name}`, t => {
    const root = fixture(t)
    mutate(root)
    const violations = validateEditorTooling(inspectEditorTooling(root))
    assert.ok(violations.some(row => row.code === code), JSON.stringify(violations))
  })
}

for (const value of ['/usr/local/bin/oxlint', 'C:\\tools\\oxlint.exe', '${workspaceFolder}/frontend/node_modules/oxlint/bin/oxlint', '${env:HOME}/oxlint', '%APPDATA%/oxlint', 'oxlint']) {
  test(`rejects a global or unsupported binary path ${value}`, t => {
    const root = fixture(t)
    edit(root, '.vscode/settings.json', s => { s['oxc.path.oxlint'] = value })
    assert.ok(validateEditorTooling(inspectEditorTooling(root)).some(row => row.code === 'editor-oxlint'))
  })
}

test('missing settings fail at the file boundary', t => {
  const root = fixture(t)
  rmSync(join(root, 'frontend/.vscode/settings.json'))
  assert.throws(() => inspectEditorTooling(root), /ENOENT.*settings.json/)
})

test('rejects an absolute SDK path even when the installed package is correct', t => {
  const root = fixture(t)
  edit(root, '.vscode/settings.json', s => { s['js/ts.tsdk.path'] = join(root, 'frontend/node_modules/.tsc-rs-sdk') })
  assert.ok(validateEditorTooling(inspectEditorTooling(root)).some(row => row.code === 'editor-relative-path'))
})

test('guard diagnoses a stale SDK without repairing it', t => {
  const root = fixture(t)
  const link = join(root, 'frontend/node_modules/.tsc-rs-sdk')
  rmSync(link); symlinkSync('@tsc-rs/darwin-x64/lib', link)
  assert.ok(validateEditorTooling(inspectEditorTooling(root)).some(row => row.code === 'editor-sdk'))
  assert.equal(readlinkSync(link), '@tsc-rs/darwin-x64/lib')
})
test('guard requires the stable SDK link rather than a direct platform path', t => {
  const root = fixture(t)
  edit(root, '.vscode/settings.json', s => { s['js/ts.tsdk.path'] = `./frontend/node_modules/@tsc-rs/${process.platform}-${process.arch}/lib` })
  assert.ok(validateEditorTooling(inspectEditorTooling(root)).some(row => row.code === 'editor-sdk'))
})
