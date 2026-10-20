import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixtures = join(root, 'scripts/fixtures/frontend-watch')
const supported = ['linux', 'darwin'].includes(process.platform)

async function waitFor(predicate, detail, timeout = 6000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(20)
  }
  assert.fail(`Timed out waiting for ${detail}`)
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

async function listener(t) {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return server
}

async function portIsFree(port) {
  const server = createServer()
  try {
    server.listen(port, '127.0.0.1')
    await once(server, 'listening')
    return true
  } catch (error) {
    if (error.code === 'EADDRINUSE') return false
    throw error
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function fixture(t, config = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'qa-scribe-frontend-watch-'))
  const frontend = join(scratch, 'frontend')
  mkdirSync(join(scratch, 'scripts'))
  mkdirSync(frontend)
  copyFileSync(join(root, 'scripts/run-frontend-dev.mjs'), join(scratch, 'scripts/run-frontend-dev.mjs'))
  writeFileSync(join(frontend, 'package.json'), '{}')
  writeFileSync(join(frontend, 'fixture.json'), JSON.stringify(config))
  for (const name of ['tsc-rs', 'vite']) {
    const packageDir = join(frontend, 'node_modules', name)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name, bin: { [name]: 'launcher.mjs' } }))
    copyFileSync(join(fixtures, 'process.mjs'), join(packageDir, 'launcher.mjs'))
  }
  const sessions = []
  const journal = () => existsSync(join(frontend, 'pids.jsonl'))
    ? readFileSync(join(frontend, 'pids.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
  const groups = () => existsSync(join(frontend, 'groups.jsonl'))
    ? readFileSync(join(frontend, 'groups.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
  t.after(async () => {
    for (const session of sessions) {
      if (session.child.exitCode === null && session.child.signalCode === null) {
        session.child.kill('SIGTERM')
        const result = await Promise.race([session.done, delay(3500, 'timeout', { ref: false })])
        if (result === 'timeout') session.child.kill('SIGKILL')
      }
    }
    for (const { pid, role } of journal()) {
      try { process.kill(role === 'native' ? pid : -pid, 'SIGKILL') } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    for (const { pid } of groups()) {
      try { process.kill(-pid, 'SIGKILL') } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    await Promise.all(sessions.map((session) => session.done))
    rmSync(scratch, { recursive: true, force: true })
  })
  function launch(mode = 'watch', args = []) {
    const child = spawn(process.execPath, [join(scratch, 'scripts/run-frontend-dev.mjs'), mode, ...args], {
      cwd: tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_OPTIONS: [
          `--require=${join(fixtures, 'observe.cjs')}`,
          ...(config.fault ? [`--require=${join(fixtures, 'faults.cjs')}`] : []),
          ...(config.noExecve ? [`--require=${join(fixtures, 'no-execve.cjs')}`] : []),
        ].join(' '),
      },
    })
    const session = { child, output: '', done: null }
    child.stdout.on('data', (chunk) => { session.output += chunk })
    child.stderr.on('data', (chunk) => { session.output += chunk })
    session.done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    sessions.push(session)
    return session
  }
  async function finished(session, code) {
    const result = await Promise.race([session.done, delay(5000, 'timeout', { ref: false })])
    assert.deepEqual(result, { code, signal: null }, session.output)
    await waitFor(() => journal().every(({ pid }) => !alive(pid)) && groups().every(({ pid }) => !alive(-pid)),
      'every literal fixture PID and owned group to disappear')
    for (const { pid } of groups()) assert.equal(alive(-pid), false, `owned group ${pid} must disappear`)
  }
  return { scratch, frontend, journal, groups, launch, finished }
}

test('watch CLI resolves declared bins and watches both projects with preserved output', { skip: !supported, timeout: 15000 }, async (t) => {
  const f = fixture(t)
  const s = f.launch()
  await waitFor(() => f.journal().length === 2, 'two watcher PIDs')
  const records = f.journal().sort((a, b) => a.role.localeCompare(b.role))
  assert.deepEqual(records.map(({ role, args }) => ({ role, args })), [
    { role: 'config', args: ['--noEmit', '-p', 'tsconfig.node.json', '--watch', '--preserveWatchOutput'] },
    { role: 'ui', args: ['--noEmit', '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'] },
  ])
  assert.equal(new Set(records.map(({ pid }) => pid)).size, 2)
  s.child.kill('SIGINT')
  await f.finished(s, 130)
})

for (const behavior of ['zero', 'nonzero', 'signal']) {
  test(`unexpected ${behavior} watcher exit fails and cleans siblings`, { skip: !supported, timeout: 15000 }, async (t) => {
    const f = fixture(t, { config: behavior })
    const s = f.launch()
    await f.finished(s, 1)
    assert.match(s.output, /config exited unexpectedly/)
    assert.equal(f.journal().length, 2)
  })
}

for (const fault of ['enoent', 'throw', 'no-close']) {
  test(`${fault} after a sibling starts has bounded cleanup`, { skip: !supported, timeout: 15000 }, async (t) => {
    const f = fixture(t, { fault })
    const start = performance.now()
    const s = f.launch()
    await f.finished(s, 1)
    assert.match(s.output, fault === 'enoent' ? /config launch failed:.*ENOENT/ : /EMFILE/)
    assert.equal(f.journal().length, 1)
    if (fault === 'no-close') assert.match(s.output, /config did not close before the cleanup deadline/)
    assert.ok(performance.now() - start < 3000, 'even missing close must finish within three seconds')
  })
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  test(`${signal} cleans three groups and frees the owned port`, { skip: !supported, timeout: 15000 }, async (t) => {
    const server = await listener(t)
    const port = server.address().port
    await new Promise((resolve) => server.close(resolve))
    const f = fixture(t, { port })
    const s = f.launch('checked')
    await waitFor(() => f.journal().length === 3 && existsSync(join(f.frontend, 'listening')), 'three ready groups')
    const vite = f.journal().find(({ role }) => role === 'vite')
    assert.equal(f.groups().length, 3)
    assert.deepEqual(vite.args, ['--strictPort', '--clearScreen', 'false'])
    s.child.kill(signal)
    await f.finished(s, code)
    assert.equal(await portIsFree(port), true)
  })
}

test('group ownership survives leader exit and kills a stubborn native grandchild', { skip: !supported, timeout: 15000 }, async (t) => {
  const f = fixture(t, { ui: 'grandchild' })
  const s = f.launch()
  await waitFor(() => f.journal().length === 3, 'native grandchild PID')
  process.kill(f.journal().find(({ role }) => role === 'ui').pid, 'SIGKILL')
  await f.finished(s, 1)
  assert.match(s.output, /ui exited unexpectedly \(SIGKILL\)/)
})

test('a second interrupt accelerates SIGKILL and retains the first signal exit code', { skip: !supported, timeout: 15000 }, async (t) => {
  const f = fixture(t, { ui: 'stubborn', config: 'stubborn' })
  const s = f.launch()
  await waitFor(() => f.journal().length === 2, 'stubborn watchers')
  const start = performance.now()
  s.child.kill('SIGHUP')
  await delay(80)
  s.child.kill('SIGINT')
  await f.finished(s, 129)
  assert.ok(performance.now() - start < 950, 'second signal must skip the one-second grace')
})

test('an interrupt after a watcher failure retains the original failure', { skip: !supported, timeout: 15000 }, async (t) => {
  const f = fixture(t, { ui: 'stubborn', config: 'nonzero' })
  const s = f.launch()
  await waitFor(() => s.output.includes('config exited unexpectedly'), 'watcher failure')
  s.child.kill('SIGINT')
  await f.finished(s, 1)
})

test('unexpected group signal errors are visible and fail an interrupted session', { skip: !supported, timeout: 15000 }, async (t) => {
  const f = fixture(t, { fault: 'kill-error' })
  const s = f.launch()
  await waitFor(() => f.journal().length === 2, 'watchers')
  s.child.kill('SIGINT')
  await f.finished(s, 1)
  assert.match(s.output, /config group \d+: kill EPERM/)
})

test('ESRCH permanently retires a group while another group is still stopping', { skip: !supported, timeout: 15000 }, async (t) => {
  const f = fixture(t, { fault: 'esrch-reuse', ui: 'stubborn' })
  const s = f.launch()
  await waitFor(() => f.journal().length === 2, 'watchers')
  s.child.kill('SIGINT')
  await f.finished(s, 130)
  assert.equal(existsSync(join(f.frontend, 'retired-group-signaled')), false)
})

test('surviving groups are reported and make cleanup fail within three seconds', { skip: !supported, timeout: 15000 }, async (t) => {
  const f = fixture(t, { fault: 'survive' })
  const s = f.launch()
  await waitFor(() => f.journal().length === 2, 'watchers')
  const start = performance.now()
  const exited = once(s.child, 'exit')
  s.child.kill('SIGINT')
  const result = await Promise.race([exited, delay(3000, 'timeout', { ref: false })])
  assert.deepEqual(result, [1, null], s.output)
  assert.ok(performance.now() - start < 3000)
  assert.match(s.output, /config group \d+ survived cleanup/)
  const config = f.journal().find(({ role }) => role === 'config')
  assert.equal(alive(config.pid), true, 'fixture suppresses group signals until test cleanup')
  process.kill(-config.pid, 'SIGKILL')
  await f.finished(s, 1)
})

test('interrupt during startup cleans the already launched sibling', { skip: !supported, timeout: 15000 }, async (t) => {
  const f = fixture(t, { fault: 'startup' })
  const s = f.launch()
  await waitFor(() => f.journal().length === 1, 'first watcher startup')
  s.child.kill('SIGINT')
  await f.finished(s, 130)
})

test('repeated checked launches release all groups and the same owned port', { skip: !supported, timeout: 20000 }, async (t) => {
  const server = await listener(t)
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  const f = fixture(t, { port })
  for (let iteration = 1; iteration <= 3; iteration++) {
    rmSync(join(f.frontend, 'listening'), { force: true })
    const s = f.launch('checked')
    await waitFor(() => f.journal().length === iteration * 3 && existsSync(join(f.frontend, 'listening')), 'checked readiness')
    s.child.kill('SIGINT')
    await f.finished(s, 130)
    assert.equal(await portIsFree(port), true)
  }
  assert.equal(new Set(f.journal().map(({ pid }) => pid)).size, 9)
})

test('real Vite busy port fails, cleans watchers, and preserves the unrelated listener', { skip: !supported, timeout: 20000 }, async (t) => {
  const server = await listener(t)
  const port = server.address().port
  const f = fixture(t)
  rmSync(join(f.frontend, 'node_modules/vite'), { recursive: true })
  symlinkSync(join(root, 'frontend/node_modules/vite'), join(f.frontend, 'node_modules/vite'))
  writeFileSync(join(f.frontend, 'vite.config.mjs'), `export default {server:{host:'127.0.0.1',port:${port}}}`)
  const s = f.launch('checked')
  await f.finished(s, 1)
  assert.match(s.output, new RegExp(`Port ${port} is already in use`))
  assert.match(s.output, /vite exited unexpectedly/)
  assert.equal(server.listening, true)
  assert.equal(await portIsFree(port), false)
  assert.equal(f.journal().length, 2)
})

test('missing compiler metadata and unsupported CLI arguments launch no children', { skip: !supported, timeout: 15000 }, async (t) => {
  const f = fixture(t)
  rmSync(join(f.frontend, 'node_modules/tsc-rs'), { recursive: true })
  const s = f.launch()
  await f.finished(s, 1)
  assert.match(s.output, /Cannot find module 'tsc-rs\/package.json'/)
  const invalid = f.launch('watch', ['--config', 'elsewhere'])
  await f.finished(invalid, 1)
  assert.match(invalid.output, /Usage:/)
  assert.deepEqual(f.journal(), [])
})

for (const noExecve of [false, true]) {
  test(`real native watchers recover from UI, config, and TSX errors (${noExecve ? 'launcher fallback' : 'default launcher'})`, { skip: !supported, timeout: 90000 }, async (t) => {
    const f = fixture(t, { noExecve })
    rmSync(f.frontend, { recursive: true })
    cpSync(join(root, 'frontend'), f.frontend, {
      recursive: true,
      filter: (source) => !['node_modules', 'dist', '.git'].includes(source.split('/').at(-1)) && !source.endsWith('.tsbuildinfo'),
    })
    symlinkSync(join(root, 'frontend/node_modules'), join(f.frontend, 'node_modules'))
    const s = f.launch()
    t.after(() => t.diagnostic(s.output))
    async function outputAfter(action, pattern) {
      const offset = s.output.length
      action()
      await waitFor(() => pattern.test(s.output.slice(offset)), `${pattern}\n${s.output.slice(offset)}`, 20000)
    }
    await waitFor(() => (s.output.match(/Found 0 errors/g) ?? []).length >= 2, `both actual watchers ready\n${s.output}`, 30000)
    const processes = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' }).trim().split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number))
    const groups = processes.filter(([, parent]) => parent === s.child.pid).map(([pid]) => pid)
    assert.equal(groups.length, 2, 'actual compiler launches own exactly two process groups')
    const owned = processes.filter(([, , group]) => groups.includes(group))
    if (noExecve) assert.equal(owned.length, 4, 'fallback retains two Node launchers and two native compilers in two groups')
    writeFileSync(join(f.frontend, 'pids.jsonl'), owned
      .map(([pid, , group]) => JSON.stringify({ role: pid === group ? 'real' : 'native', pid })).join('\n') + '\n')
    const source = join(f.frontend, 'src/watch-fixture.tsx')
    const config = join(f.frontend, 'vite.config.ts')
    const validConfig = readFileSync(config, 'utf8')
    const cases = [
      [source, 'export const value: string = 123', 'export const value: string = "valid"'],
      [config, `${validConfig}\nexport const watchFixture: number = "invalid"`, validConfig],
      [source, 'export const View = () => <button disabled="invalid">Invalid</button>', 'export const View = () => <button disabled={true}>Valid</button>'],
    ]
    for (const [file, invalid, valid] of cases) {
      const filename = file === config ? /vite\.config\.ts.*TS2322/ : /watch-fixture\.tsx.*TS2322/
      await outputAfter(() => writeFileSync(file, invalid), filename)
      assert.equal(s.child.exitCode, null, 'ordinary native diagnostics keep the session alive')
      await outputAfter(() => writeFileSync(file, valid), /Found 0 errors/)
      assert.equal(s.child.exitCode, null, 'repair recovers in the original session')
    }
    console.log('Actual tsc-rs watch subprocesses reported TS2322 and recovered for UI, Vite config, and TSX props.')
    s.child.kill('SIGINT')
    await f.finished(s, 130)
  })
}
