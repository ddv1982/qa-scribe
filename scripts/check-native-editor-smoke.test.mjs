import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareRustSdk } from './prepare-rust-typescript-sdk.mjs'
import { inside, prepareWorkspace, privateEnvironment, ProbeChildren, verifyReleased } from './check-native-editor-smoke.mjs'

test('cleanup verification refuses a live debug listener', async () => {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try { await assert.rejects(verifyReleased({ port }), /remains open/) }
  finally { await new Promise(resolve => server.close(resolve)) }
  assert.equal((await verifyReleased({ port })).portClosed, true)
})

test('disposable setup copies linked installation bytes before owning its SDK link', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-editor-setup-'))
  try {
    const source = join(root, 'source'); const project = join(root, 'project'); const store = join(root, 'store')
    const modules = join(source, 'frontend/node_modules'); const native = join(modules, `@tsc-rs/${process.platform}-${process.arch}`)
    for (const directory of [join(source, 'frontend'), join(project, 'frontend'), join(modules, 'tsc-rs'), join(native, 'lib')]) mkdirSync(directory, { recursive: true })
    writeFileSync(join(source, 'frontend/package.json'), JSON.stringify({ devDependencies: { 'tsc-rs': '0.8.0' } }))
    writeFileSync(join(project, 'frontend/package.json'), JSON.stringify({ devDependencies: { 'tsc-rs': '0.8.0' } }))
    writeFileSync(join(modules, 'tsc-rs/package.json'), JSON.stringify({ name: 'tsc-rs', version: '0.8.0', optionalDependencies: { [`@tsc-rs/${process.platform}-${process.arch}`]: '0.8.0' } }))
    writeFileSync(join(native, 'package.json'), JSON.stringify({ name: `@tsc-rs/${process.platform}-${process.arch}`, version: '0.8.0', os: [process.platform], cpu: [process.arch] }))
    mkdirSync(store)
    const binary = join(store, 'binary'); writeFileSync(binary, 'shared vendor bytes'); chmodSync(binary, 0o755)
    linkSync(binary, join(native, 'lib/tsc'))
    for (const name of ['lib.d.ts', 'lib.es5.d.ts', 'lib.dom.d.ts', 'lib.esnext.full.d.ts']) writeFileSync(join(native, 'lib', name), '')
    assert.throws(() => prepareWorkspace(source, project), /Rust SDK link missing/, 'A missing source SDK link must not be repaired by the smoke')
    prepareRustSdk(join(source, 'frontend'))
    const sourceLink = statSync(join(modules, '.tsc-rs-sdk'))
    const result = prepareWorkspace(source, project)
    assert.equal(readlinkSync(join(project, 'frontend/node_modules/.tsc-rs-sdk')), `@tsc-rs/${process.platform}-${process.arch}/lib`)
    assert.equal(realpathSync(join(project, 'frontend/node_modules/.tsc-rs-sdk')), join(project, `frontend/node_modules/@tsc-rs/${process.platform}-${process.arch}/lib`))
    assert.notEqual(statSync(result.executable).ino, statSync(binary).ino)
    writeFileSync(result.executable, 'changed disposable copy')
    assert.equal(readFileSync(binary, 'utf8'), 'shared vendor bytes')
    assert.equal(readlinkSync(join(modules, '.tsc-rs-sdk')), `@tsc-rs/${process.platform}-${process.arch}/lib`)
    assert.equal(statSync(join(modules, '.tsc-rs-sdk')).ino, sourceLink.ino)
    assert.throws(() => prepareWorkspace(source, project), /must not contain an installation/)
    assert.throws(() => inside(project, store), /escapes/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cleanup refuses ancestors and stale identities and leaves unowned siblings alive', async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-editor-cleanup-'))
  const owner = new ProbeChildren(root)
  const sibling = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore' })
  const siblingExit = new Promise(resolve => sibling.once('close', resolve))
  try {
    const env = privateEnvironment(join(root, 'home'))
    const child = await owner.launch('owned-child', process.execPath, ['-e', 'setInterval(() => {}, 1000)'], env, root)
    const identity = owner.collect().find(row => row.pid === child.child.pid)
    assert.ok(identity, 'Actual launched process must be observed')
    for (const pid of [1, process.pid, process.ppid]) assert.throws(() => owner.signal({ pid, start: 'forged' }, 'SIGTERM'), /ancestor/)
    assert.throws(() => owner.signal({ pid: sibling.pid, start: 'unowned' }, 'SIGTERM'), /recorded owned/)
    const stale = { ...identity, start: 'a previous process incarnation' }
    owner.owned.set(`${stale.pid}:${stale.start}`, stale)
    assert.equal(owner.signal(stale, 'SIGTERM'), false)
    assert.doesNotThrow(() => process.kill(child.child.pid, 0))
    await owner.cleanup()
    await child.done
    assert.doesNotThrow(() => process.kill(sibling.pid, 0))
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'cleanup.json'), 'utf8')).remaining, [])
    const signals = readFileSync(join(root, 'signals.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.ok(signals.every(row => row.pid === child.child.pid && row.start === identity.start && row.loggedBeforeIssuance))
  } finally {
    await owner.cleanup()
    sibling.kill('SIGTERM'); await siblingExit
    rmSync(root, { recursive: true, force: true })
  }
})
