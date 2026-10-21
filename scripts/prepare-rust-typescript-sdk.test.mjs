import assert from 'node:assert/strict'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { assertRustSdkPrepared, resolveRustSdk } from './rust-typescript-sdk.mjs'
import { prepareRustSdk } from './prepare-rust-typescript-sdk.mjs'

const write = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)) }
const edit = (file, change) => { const value = JSON.parse(readFileSync(file)); change(value); write(file, value) }
function fixture(t, host = { platform: 'linux', arch: 'x64' }, nested = false) {
  const root = mkdtempSync(join(tmpdir(), 'rust-sdk-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const frontend = join(root, 'frontend'); const modules = join(frontend, 'node_modules'); const tuple = `${host.platform}-${host.arch}`
  const umbrella = join(modules, nested ? '.bun/tsc-rs@0.7.0/node_modules/tsc-rs' : 'tsc-rs')
  const native = join(modules, nested ? `.bun/@tsc-rs+${tuple}@0.7.0/node_modules/@tsc-rs/${tuple}` : `@tsc-rs/${tuple}`)
  write(join(frontend, 'package.json'), { devDependencies: { 'tsc-rs': '0.7.0' } })
  write(join(umbrella, 'package.json'), { name: 'tsc-rs', version: '0.7.0', optionalDependencies: { [`@tsc-rs/${tuple}`]: '0.7.0' } })
  write(join(native, 'package.json'), { name: `@tsc-rs/${tuple}`, version: '0.7.0', os: [host.platform], cpu: [host.arch] })
  write(join(native, 'lib/tsc'), '#!/bin/sh\nexit 0\n'); chmodSync(join(native, 'lib/tsc'), 0o755)
  for (const file of ['lib.d.ts', 'lib.es5.d.ts', 'lib.dom.d.ts', 'lib.esnext.full.d.ts']) write(join(native, 'lib', file), 'declare const library: number\n')
  if (nested) {
    symlinkSync(relative(modules, umbrella), join(modules, 'tsc-rs'))
    const lookup = join(dirname(umbrella), `@tsc-rs/${tuple}`); mkdirSync(dirname(lookup), { recursive: true })
    symlinkSync(relative(dirname(lookup), native), lookup)
  }
  return { root, frontend, modules, umbrella, native, host, link: join(modules, '.tsc-rs-sdk') }
}

for (const host of [{ platform: 'linux', arch: 'x64' }, { platform: 'darwin', arch: 'arm64' }, { platform: 'darwin', arch: 'x64' }]) {
  test(`preparation and read-only resolution on ${host.platform}-${host.arch}`, t => {
    const f = fixture(t, host); const sdk = resolveRustSdk(f.frontend, host)
    assert.equal(existsSync(f.link), false, 'Read-only resolution must not repair')
    assert.deepEqual(sdk, { platform: host.platform, arch: host.arch, umbrella: { name: 'tsc-rs', version: '0.7.0', root: f.umbrella }, native: { name: `@tsc-rs/${host.platform}-${host.arch}`, version: '0.7.0', root: f.native }, libDir: join(f.native, 'lib'), executable: join(f.native, 'lib/tsc'), linkPath: f.link, relativeTarget: `@tsc-rs/${host.platform}-${host.arch}/lib` })
    assert.throws(() => assertRustSdkPrepared(sdk), /Rust SDK link missing/)
    prepareRustSdk(f.frontend, host); const before = lstatSync(f.link)
    assertRustSdkPrepared(sdk); prepareRustSdk(f.frontend, host)
    assert.equal(lstatSync(f.link).ino, before.ino, 'Repeated preparation preserves the link')
    assert.equal(readFileSync(sdk.executable, 'utf8'), '#!/bin/sh\nexit 0\n')
  })
}

test('umbrella-relative nested Bun resolution and relocation', t => {
  const f = fixture(t, undefined, true)
  write(join(f.modules, '@tsc-rs/linux-x64/package.json'), { name: 'foreign-top-level', version: '9.0.0' })
  const sdk = prepareRustSdk(f.frontend, f.host)
  assert.equal(sdk.relativeTarget, '.bun/@tsc-rs+linux-x64@0.7.0/node_modules/@tsc-rs/linux-x64/lib')
  const relocated = join(f.root, 'moved'); renameSync(f.frontend, relocated)
  assertRustSdkPrepared(resolveRustSdk(relocated, f.host))
})

for (const target of ['@tsc-rs/darwin-arm64/lib', '.bun/@tsc-rs+linux-x64@0.6.0/node_modules/@tsc-rs/linux-x64/lib']) {
  test(`stale or dangling helper link is replaced: ${target}`, t => {
    const f = fixture(t); symlinkSync(target, f.link)
    assert.throws(() => assertRustSdkPrepared(resolveRustSdk(f.frontend, f.host)), /stale or foreign/)
    prepareRustSdk(f.frontend, f.host)
    assert.equal(readlinkSync(f.link), '@tsc-rs/linux-x64/lib')
    rmSync(f.link)
    assertRustSdkPrepared(prepareRustSdk(f.frontend, f.host))
  })
}

for (const target of ['/tmp/foreign-sdk', '../private/lib', 'unrelated/@tsc-rs/linux-x64/lib', '.bun/@tsc-rs+linux-x64@0.7.0/node_modules/@tsc-rs/darwin-x64/lib']) {
  test(`foreign link is preserved: ${target}`, t => {
    const f = fixture(t); symlinkSync(target, f.link)
    assert.throws(() => prepareRustSdk(f.frontend, f.host), /Refusing foreign/)
    assert.equal(readlinkSync(f.link), target)
  })
}
for (const directory of [false, true]) {
  test(`unexpected ${directory ? 'directory' : 'file'} is preserved`, t => {
    const f = fixture(t)
    if (directory) mkdirSync(f.link)
    writeFileSync(directory ? join(f.link, 'sentinel') : f.link, 'leave this alone')
    assert.throws(() => prepareRustSdk(f.frontend, f.host), /Refusing to replace/)
    assert.equal(readFileSync(directory ? join(f.link, 'sentinel') : f.link, 'utf8'), 'leave this alone')
  })
}

const mutations = [
  ['missing umbrella', f => rmSync(f.umbrella, { recursive: true }), /Cannot find module/],
  ['missing native', f => rmSync(f.native, { recursive: true }), /Cannot find module/],
  ['umbrella identity', f => edit(join(f.umbrella, 'package.json'), p => { p.name = 'foreign' }), /umbrella identity/],
  ['umbrella version', f => edit(join(f.umbrella, 'package.json'), p => { p.version = '0.6.0' }), /umbrella version/],
  ['native version', f => edit(join(f.native, 'package.json'), p => { p.version = '0.6.0' }), /native version/],
  ['umbrella host pin', f => edit(join(f.umbrella, 'package.json'), p => { p.optionalDependencies['@tsc-rs/linux-x64'] = '0.6.0' }), /pinned host package/],
  ['wrong native name', f => edit(join(f.native, 'package.json'), p => { p.name = '@tsc-rs/darwin-x64' }), /native identity/],
  ['wrong OS', f => edit(join(f.native, 'package.json'), p => { p.os = ['darwin'] }), /native OS/],
  ['wrong CPU', f => edit(join(f.native, 'package.json'), p => { p.cpu = ['arm64'] }), /native architecture/],
  ['missing executable', f => rmSync(join(f.native, 'lib/tsc')), /ENOENT/],
  ['non-executable', f => chmodSync(join(f.native, 'lib/tsc'), 0o644), /EACCES/],
  ['missing library', f => rmSync(join(f.native, 'lib/lib.dom.d.ts')), /Missing Rust SDK library/],
  ['escaping executable', f => { write(join(f.root, 'foreign'), 'not the compiler'); rmSync(join(f.native, 'lib/tsc')); symlinkSync(join(f.root, 'foreign'), join(f.native, 'lib/tsc')) }, /escapes/],
  ['escaping library', f => { write(join(f.root, 'foreign'), 'not a library'); rmSync(join(f.native, 'lib/lib.dom.d.ts')); symlinkSync(join(f.root, 'foreign'), join(f.native, 'lib/lib.dom.d.ts')) }, /escapes/],
]
for (const [name, mutate, expected] of mutations) test(`invalid SDK fails before replacing a stale link: ${name}`, t => {
  const f = fixture(t); symlinkSync('@tsc-rs/darwin-x64/lib', f.link); mutate(f)
  assert.throws(() => prepareRustSdk(f.frontend, f.host), expected)
  assert.equal(readlinkSync(f.link), '@tsc-rs/darwin-x64/lib')
})
test('unsupported hosts fail closed', t => {
  const f = fixture(t)
  assert.throws(() => resolveRustSdk(f.frontend, { platform: 'win32', arch: 'x64' }), /Unsupported/)
})
test('shared node_modules cannot receive the reserved link', t => {
  const f = fixture(t); const store = join(f.root, 'store'); renameSync(f.modules, store); symlinkSync(store, f.modules)
  assert.throws(() => prepareRustSdk(f.frontend, f.host), /shared symlink/)
  assert.equal(existsSync(join(store, '.tsc-rs-sdk')), false)
})
for (const kind of ['umbrella', 'native']) {
  test(`${kind} package cannot escape the installation`, t => {
    const f = fixture(t); const original = f[kind]; const foreign = join(f.root, 'foreign-package')
    renameSync(original, foreign); symlinkSync(foreign, original)
    assert.throws(() => resolveRustSdk(f.frontend, f.host), /escapes/)
    assert.equal(existsSync(f.link), false)
  })
}
test('referenced standard libraries must exist inside the SDK', t => {
  const f = fixture(t)
  write(join(f.native, 'lib/lib.d.ts'), '/// <reference lib="missing" />\n')
  assert.throws(() => resolveRustSdk(f.frontend, f.host), /ENOENT/)
})
