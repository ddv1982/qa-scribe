import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, symlinkSync, readdirSync, createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertRustSdkPrepared, resolveRustSdk } from './rust-typescript-sdk.mjs'
import { inspectEditorTooling, validateEditorTooling } from './native-tooling-editor.mjs'
import { inspectFrontend } from './native-tooling-inventory.mjs'
import { validateNativeTooling } from './native-tooling-policy.mjs'

const pins = { editor: '1.142.0', typescript: '1.0.1', oxc: '1.64.1', playwright: '1.64.1' }
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const save = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export function inside(root, file) {
  assert.ok(isAbsolute(root) && isAbsolute(file), 'Paths must be explicit and absolute')
  const path = relative(realpathSync(root), realpathSync(file))
  assert.ok(path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path), `Path escapes ${root}`)
  return realpathSync(file)
}

export function privateEnvironment(home) {
  mkdirSync(join(home, 'bin'), { recursive: true })
  chmodSync(home, 0o700)
  symlinkSync(process.execPath, join(home, 'bin/node'))
  const path = `${join(home, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`
  writeFileSync(join(home, '.profile'), `export PATH='${path.replaceAll("'", "'\\''")}'\n`)
  return { HOME: home, PATH: path, SHELL: '/bin/sh', LANG: 'en_US.UTF-8', XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), XDG_RUNTIME_DIR: home, GIO_USE_VFS: 'local', GTK_USE_PORTAL: '0', NO_AT_BRIDGE: '1' }
}

export async function waitForCompletions(widget, completions, deadline) {
  const remaining = () => {
    const timeout = deadline - Date.now()
    assert.ok(timeout > 0, 'Completion readiness deadline')
    return timeout
  }
  await widget.waitFor({ state: 'visible', timeout: remaining() })
  for (const item of completions) {
    await widget.getByRole('option').getByText(item, { exact: true }).waitFor({ state: 'visible', timeout: remaining() })
  }
}

export async function verifyReleased({ port, display }) {
  if (port) await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); reject(new Error(`Owned debug port ${port} remains open`)) })
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`Cannot verify debug port ${port} closure`)) })
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error))
  })
  if (display) assert.ok(!existsSync(`/tmp/.X${display}-lock`) && !existsSync(`/tmp/.X11-unix/X${display}`), 'Owned display must be released')
  return { port, display, portClosed: true, displayReleased: true }
}

export class ProbeChildren {
  constructor(output) {
    this.output = output
    this.owned = new Map()
    this.launches = []
    this.observe()
  }
  observe() {
    this.timer ??= setInterval(() => { try { this.collect() } catch (error) { this.observationError = error } }, 150)
  }
  rows() {
    const result = spawnSync('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,lstart=,stat=,comm='], { encoding: 'utf8', timeout: 2000, env: { PATH: '/usr/bin:/bin', LANG: 'C' } })
    assert.equal(result.status, 0, 'Process observation must succeed')
    return result.stdout.split('\n').flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(\S+)\s+(.+)$/.exec(line)
      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), start: match[3], state: match[4], executable: match[5], raw: line.trim() }] : []
    })
  }
  forbidden(rows) {
    const ids = new Set([1, process.pid])
    let row = rows.find(row => row.pid === process.ppid)
    while (row && !ids.has(row.pid)) { ids.add(row.pid); row = rows.find(parent => parent.pid === row.ppid) }
    return ids
  }
  collect() {
    const rows = this.rows()
    const forbidden = this.forbidden(rows)
    for (let changed = true; changed;) {
      changed = false
      const parents = new Set(rows.filter(row => this.owned.has(`${row.pid}:${row.start}`)).map(row => row.pid))
      for (const row of rows) {
        const key = `${row.pid}:${row.start}`
        if (parents.has(row.ppid) && !this.owned.has(key)) {
          assert.ok(!forbidden.has(row.pid), 'Never admit an ancestor')
          this.owned.set(key, row); changed = true
        }
      }
    }
    save(join(this.output, 'owned-processes.json'), [...this.owned.values()])
    return rows.filter(row => this.owned.has(`${row.pid}:${row.start}`))
  }
  signal(row, signal) {
    const rows = this.rows()
    assert.ok(!this.forbidden(rows).has(row.pid), 'Never signal self or an ancestor')
    assert.ok(this.owned.has(`${row.pid}:${row.start}`), 'Only a recorded owned identity may be signaled')
    if (!rows.some(live => live.pid === row.pid && live.start === row.start && !live.state.startsWith('Z'))) return false
    writeFileSync(join(this.output, 'signals.jsonl'), `${JSON.stringify({ ...row, signal, at: new Date().toISOString(), loggedBeforeIssuance: true })}\n`, { flag: 'a' })
    try { process.kill(row.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
    return true
  }
  async launch(label, executable, args, env, cwd) {
    assert.ifError(this.observationError)
    this.observe()
    const log = openSync(join(this.output, `${label}.log`), 'w')
    const errors = openSync(join(this.output, `${label}.stderr.log`), 'w')
    const child = spawn('/bin/sh', ['-c', 'kill -STOP "$$"; exec "$@"', 'editor-smoke', executable, ...args], { cwd, env, stdio: ['ignore', log, errors] })
    closeSync(log); closeSync(errors)
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
    done.catch(() => {})
    const deadline = Date.now() + 3000
    let row
    while (!(row = this.rows().find(row => row.pid === child.pid && row.state.startsWith('T')))) {
      assert.ok(Date.now() < deadline, `Could not record stopped child ${label}`)
      await sleep(20)
    }
    assert.equal(row.ppid, process.pid, 'Launch root must be a direct child')
    assert.ok(!this.forbidden(this.rows()).has(row.pid), 'Launch root cannot be an ancestor')
    this.owned.set(`${row.pid}:${row.start}`, row)
    this.launches.push({ ...row, label, executable, args, environmentKeys: Object.keys(env).sort() })
    save(join(this.output, 'launches.json'), this.launches)
    this.signal(row, 'SIGCONT')
    return { child, done }
  }
  async cleanup() {
    clearInterval(this.timer)
    this.timer = undefined
    this.collect()
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      for (const row of [...this.owned.values()].reverse()) this.signal(row, signal)
      await sleep(1000)
    }
    const remaining = this.collect().filter(row => !row.state.startsWith('Z'))
    save(join(this.output, 'cleanup.json'), { remaining, individualSignalsOnly: true, ancestorsForbidden: true, observationError: this.observationError?.message })
    assert.ifError(this.observationError)
    assert.deepEqual(remaining, [], 'All owned processes must stop')
  }
}

export function prepareWorkspace(source, project) {
  const sourceModules = join(source, 'frontend/node_modules')
  assertRustSdkPrepared(resolveRustSdk(join(source, 'frontend')))
  const modules = join(project, 'frontend/node_modules')
  assert.ok(!existsSync(modules), 'Export must not contain an installation')
  cpSync(sourceModules, modules, { recursive: true, verbatimSymlinks: true })
  const checkLinks = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) inside(modules, path)
      else if (entry.isDirectory()) checkLinks(path)
    }
  }
  checkLinks(modules)
  const sdk = resolveRustSdk(join(project, 'frontend'))
  assertRustSdkPrepared(sdk)
  return { ...sdk, sha256: hash(sdk.executable) }
}

export async function editorSmoke({ source, output, provision = false, tools = process.env }) {
  const started = Date.now()
  const deadline = started + 570_000
  const budget = (ms = 10_000) => { assert.ok(Date.now() < deadline, 'Global editor smoke deadline'); return Math.min(ms, deadline - Date.now()) }
  assert.ok(['linux-x64', 'darwin-arm64', 'darwin-x64'].includes(`${process.platform}-${process.arch}`))
  assert.ok(isAbsolute(output) && !existsSync(output), 'Use a new absolute output directory')
  const temporary = realpathSync(process.env.RUNNER_TEMP || tmpdir())
  inside(temporary, dirname(output))
  mkdirSync(output, { mode: 0o700 }); inside(temporary, output)
  const home = join(output, 'provision-home')
  const env = privateEnvironment(home)
  const owner = new ProbeChildren(output)
  const resources = []
  let browser
  let page
  const cutoff = setTimeout(() => { void browser?.close().catch(() => {}) }, budget(570_000))
  const receipt = { platform: `${process.platform}-${process.arch}`, pins, cases: [], source, started: new Date(started).toISOString() }
  const run = async (label, executable, args, commandEnv = env, timeout = 45_000, cwd = source) => {
    budget()
    const process = await owner.launch(label, executable, args, commandEnv, cwd)
    let timer
    try {
      const result = await Promise.race([process.done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), budget(timeout)) })])
      assert.equal(result.code, 0, `${label} failed; see its log`)
    } finally { clearTimeout(timer) }
    return readFileSync(join(output, `${label}.log`), 'utf8').trim()
  }
  try {
    receipt.sourceSHA = await run('source-sha', '/usr/bin/git', ['rev-parse', 'HEAD'])
    if (process.platform === 'darwin') {
      const swiftEnv = { ...env, CLANG_MODULE_CACHE_PATH: join(home, 'clang-cache'), SWIFT_MODULECACHE_PATH: join(home, 'swift-cache') }
      receipt.quartz = await run('quartz', '/usr/bin/swift', ['-e', 'import CoreGraphics\nimport Darwin\nguard CGSessionCopyCurrentDictionary() != nil else { fputs("No Quartz GUI session\\n", stderr); exit(1) }; print("Quartz GUI session available")'], swiftEnv, 90_000)
      receipt.macOS = await run('sw-vers', '/usr/bin/sw_vers', [])
      receipt.uname = await run('uname', '/usr/bin/uname', ['-srm'])
      receipt.runnerImage = { version: tools.ImageVersion, os: tools.ImageOS }
    }
    save(join(output, 'preflight.json'), receipt)
    if (provision) {
      assert.equal(process.platform, 'darwin', 'CI provisioning is scoped to macOS')
      const directory = join(output, 'tools'); mkdirSync(directory)
      const downloads = []
      const download = async (name, url) => {
        const file = join(directory, name)
        const response = await fetch(url, { signal: AbortSignal.timeout(budget(90_000)) })
        assert.ok(response.ok, `Download ${name}: HTTP ${response.status}`)
        await pipeline(Readable.fromWeb(response.body), createWriteStream(file))
        downloads.push({ url, file, sha256: hash(file) }); save(join(output, 'downloads.json'), downloads)
        return file
      }
      const editorPlatform = process.arch === 'x64' ? 'darwin' : 'darwin-arm64'
      const editorZip = await download('vscode.zip', `https://update.code.visualstudio.com/${pins.editor}/${editorPlatform}/stable`)
      await run('extract-vscode', '/usr/bin/ditto', ['-x', '-k', editorZip, directory])
      const bundle = join(directory, 'Visual Studio Code.app/Contents')
      const executable = await run('bundle-executable', '/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', join(bundle, 'Info.plist')])
      assert.ok(/^[a-zA-Z0-9_-]+$/.test(executable), 'Expected a bundle executable filename')
      const extensions = join(directory, 'extensions'); mkdirSync(extensions)
      for (const [publisher, name, version, target] of [['TypeScriptTeam', 'native-preview', pins.typescript, `?targetPlatform=darwin-${process.arch}`], ['oxc', 'oxc-vscode', pins.oxc, '']]) {
        const archive = await download(`${name}.vsix`, `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${publisher}/vsextensions/${name}/${version}/vspackage${target}`)
        const unpack = join(directory, `${name}-unpacked`)
        await run(`extract-${name}`, '/usr/bin/unzip', ['-q', archive, '-d', unpack])
        cpSync(join(unpack, 'extension'), join(extensions, `${publisher}.${name}`), { recursive: true })
      }
      const playwright = join(directory, 'playwright')
      const npm = join(dirname(process.execPath), 'npm')
      await run('install-playwright', npm, ['install', '--prefix', playwright, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `playwright-core@${pins.playwright}`], env, 120_000)
      tools = { NATIVE_EDITOR_SMOKE_EDITOR: join(bundle, 'MacOS', executable), NATIVE_EDITOR_SMOKE_EDITOR_ROOT: directory, NATIVE_EDITOR_SMOKE_EXTENSIONS: extensions, NATIVE_EDITOR_SMOKE_PLAYWRIGHT: join(playwright, 'node_modules/playwright-core') }
    }
    const editor = inside(tools.NATIVE_EDITOR_SMOKE_EDITOR_ROOT, tools.NATIVE_EDITOR_SMOKE_EDITOR)
    const playwright = inside(temporary, tools.NATIVE_EDITOR_SMOKE_PLAYWRIGHT)
    const extensionSource = inside(temporary, tools.NATIVE_EDITOR_SMOKE_EXTENSIONS)
    const app = process.platform === 'darwin' ? resolve(dirname(editor), '../Resources/app') : join(dirname(editor), 'resources/app')
    assert.equal(json(join(app, 'package.json')).version, pins.editor)
    assert.equal(json(join(playwright, 'package.json')).version, pins.playwright)
    receipt.editor = { executable: editor, sha256: hash(editor), version: pins.editor }
    receipt.extensions = []
    for (const [id, version] of [['TypeScriptTeam.native-preview', pins.typescript], ['oxc.oxc-vscode', pins.oxc]]) {
      const directory = readdirSync(extensionSource, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(extensionSource, entry.name)).find(path => { const m = json(join(path, 'package.json')); return `${m.publisher}.${m.name}`.toLowerCase() === id.toLowerCase() })
      assert.ok(directory, `Missing ${id}`)
      const manifest = json(join(directory, 'package.json')); assert.equal(manifest.version, version)
      receipt.extensions.push({ id, version, directory, manifestSHA256: hash(join(directory, 'package.json')) })
    }
    const project = join(output, 'project'); mkdirSync(project)
    await run('export-source', '/usr/bin/git', ['archive', '--format=tar', `--output=${join(output, 'source.tar')}`, 'HEAD'])
    await run('extract-source', '/usr/bin/tar', ['-xf', join(output, 'source.tar'), '-C', project])
    if (tools.NATIVE_EDITOR_SMOKE_PATCH) {
      const patch = inside(temporary, tools.NATIVE_EDITOR_SMOKE_PATCH)
      receipt.sourcePatchSHA256 = hash(patch)
      await run('check-source-patch', '/usr/bin/git', ['apply', '--check', patch], env, 45_000, project)
      await run('apply-source-patch', '/usr/bin/git', ['apply', patch], env, 45_000, project)
    }
    const parity = json(new URL('./fixtures/native-tooling/lint-parity.json', import.meta.url))
    const checkInstallation = root => {
      assert.deepEqual(validateNativeTooling(inspectFrontend(join(root, 'frontend')), parity), [], 'Microsoft SDK must be absent and native policy must pass')
      assert.deepEqual(validateEditorTooling(inspectEditorTooling(root)), [], 'Actual workspace SDK settings and prepared link must pass without repair')
    }
    checkInstallation(source)
    receipt.sdk = prepareWorkspace(source, project)
    checkInstallation(project)
    for (const file of ['.vscode/settings.json', 'frontend/.vscode/settings.json', 'frontend/package.json', 'frontend/bun.lock']) assert.equal(hash(join(project, file)), hash(join(source, file)), `Export must retain actual source ${file}`)
    const fixtureFile = new URL('./fixtures/native-tooling/editor-smoke.json', import.meta.url)
    const fixture = json(fixtureFile)
    receipt.probeSHA256 = hash(fileURLToPath(import.meta.url)); receipt.fixtureSHA256 = hash(fixtureFile)
    writeFileSync(join(project, 'frontend/src/ReviewTarget.ts'), fixture.target)
    const probe = join(project, 'frontend/src/ReviewProbe.tsx'); writeFileSync(probe, fixture.valid)
    const { chromium } = createRequire(import.meta.url)(playwright)
    for (const [name, workspace] of [['root', project], ['frontend', join(project, 'frontend')]]) {
      const directory = join(output, name); mkdirSync(directory)
      const resource = { name }; resources.push(resource)
      const childEnv = privateEnvironment(join(directory, 'home'))
      if (process.platform === 'linux') {
        const display = 190 + Math.floor(Math.random() * 100)
        assert.ok(!existsSync(`/tmp/.X${display}-lock`) && !existsSync(`/tmp/.X11-unix/X${display}`), 'Display must be unused')
        resource.display = display
        childEnv.DISPLAY = `:${display}`; childEnv.GDK_BACKEND = 'x11'
        budget(); await owner.launch(`${name}-xvfb`, '/usr/bin/Xvfb', [childEnv.DISPLAY, '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], childEnv, source)
        const ready = Date.now() + budget(5000)
        while (!existsSync(`/tmp/.X11-unix/X${display}`)) { assert.ok(Date.now() < ready, 'Xvfb readiness'); await sleep(100) }
      }
      const shell = await run(`${name}-shell-preflight`, '/bin/sh', ['-ilc', 'command -v node'], childEnv)
      assert.equal(shell, join(childEnv.HOME, 'bin/node'), 'Oxc login shell must use the private Node path')
      const profile = join(directory, 'profile'); mkdirSync(join(profile, 'User'), { recursive: true })
      save(join(profile, 'User/settings.json'), { 'workbench.startupEditor': 'none', 'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'telemetry.telemetryLevel': 'off', 'chat.disableAIFeatures': true, 'typescript.native-preview.trace.server': 'verbose', 'js/ts.showDebugInfo': true })
      const extensions = join(directory, 'extensions'); mkdirSync(extensions)
      for (const extension of receipt.extensions) cpSync(extension.directory, join(extensions, basename(extension.directory)), { recursive: true, dereference: true })
      const args = ['--user-data-dir', profile, '--shared-data-dir', join(directory, 'shared'), '--extensions-dir', extensions, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--password-store=basic', '--force-disable-user-env', '--disable-extension', 'vscode.git', '--disable-extension', 'vscode.github-authentication', '--skip-welcome', '--skip-release-notes', '--skip-add-to-recently-opened', '--new-window', workspace]
      if (process.platform === 'linux') args.unshift('--no-sandbox', '--disable-gpu', '--ozone-platform=x11')
      budget(); await owner.launch(`${name}-editor`, editor, args, childEnv, workspace)
      const ready = Date.now() + budget(45_000)
      page = undefined
      while (!page) {
        assert.ok(Date.now() < ready, '45 second workbench readiness deadline')
        if (!browser && existsSync(join(profile, 'DevToolsActivePort'))) {
          const [port, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n')
          resource.port = Number(port)
          browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${path}`, { timeout: Math.max(1, ready - Date.now()) })
        }
        page = browser?.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('vscode-file:') && page.url().includes('workbench'))
        if (!page) await sleep(100)
      }
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      const actions = []
      const capture = async label => { await page.locator('.monaco-workbench').waitFor(); assert.ok((await page.title()).includes(basename(workspace)), 'Expected workspace title'); writeFileSync(join(directory, `${label}.txt`), await page.locator('body').innerText()); await page.screenshot({ path: join(directory, `${label}.png`) }) }
      await page.getByText('Restricted Mode', { exact: false }).first().waitFor({ state: 'visible', timeout: Math.max(1, ready - Date.now()) })
      const step = async (label, action) => {
        page.setDefaultTimeout(budget()); await capture(`${actions.length}-${label}-before`)
        try { await action() }
        catch (error) { await capture(`${actions.length}-${label}-failed`).catch(() => {}); throw error }
        actions.push(label); await capture(`${actions.length}-${label}-after`); save(join(directory, 'actions.json'), actions)
      }
      const picker = page.locator('.quick-input-widget'); const query = picker.locator('input')
      const command = async text => { await page.keyboard.press(`${modifier}+Shift+p`); await query.waitFor({ state: 'visible' }); await query.fill(`>${text}`); await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: text }).first().click() }
      const open = async () => { await page.keyboard.press(`${modifier}+p`); await query.waitFor({ state: 'visible' }); await query.fill(probe); await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'ReviewProbe.tsx' }).first().click(); await picker.waitFor({ state: 'hidden' }); await page.locator(`.monaco-editor[data-uri=${JSON.stringify(pathToFileURL(probe).href)}]`).waitFor() }
      const edit = () => page.locator('.monaco-editor[data-uri^="file:"] .native-edit-context').first()
      const replace = async contents => { await edit().focus(); await edit().press(`${modifier}+a`); await page.keyboard.insertText(contents); await edit().press(`${modifier}+s`); const saved = Date.now() + budget(); while (readFileSync(probe, 'utf8') !== contents) { assert.ok(Date.now() < saved, 'Actual saved fixture bytes'); await sleep(50) } }
      const provider = label => {
        const rows = owner.collect()
        const compilers = rows.filter(row => !row.state.startsWith('Z') && basename(row.executable) === 'tsc')
        const identities = compilers.map(row => { const path = process.platform === 'linux' ? realpathSync(`/proc/${row.pid}/exe`) : realpathSync(row.executable); const sha256 = hash(path); assert.ok(owner.rows().some(live => live.pid === row.pid && live.start === row.start && !live.state.startsWith('Z')), 'Provider must remain the same live process'); return { ...row, executable: path, sha256 } })
        save(join(directory, `${label}-provider.json`), identities)
        assert.equal(identities.length, 1, 'Exactly one active compiler process')
        assert.equal(identities[0].executable, receipt.sdk.executable); assert.equal(identities[0].sha256, receipt.sdk.sha256)
      }
      await step('trust-manager', () => command('Workspaces: Manage Workspace Trust'))
      await step('trust', () => page.getByRole('button', { name: 'Trust', exact: true }).click())
      await step('open', open)
      await step('notifications', () => command('Notifications: Show Notifications'))
      await step('allow-sdk', () => page.getByRole('button', { name: 'Allow', exact: true }).click())
      await step('close-notifications', () => page.keyboard.press('Escape'))
      await step('problems', () => command('View: Toggle Problems'))
      for (const cycle of ['initial', 'reloaded']) {
        if (cycle === 'reloaded') {
          await step('reload', async () => {
            await Promise.all([page.waitForEvent('domcontentloaded', { timeout: budget(45_000) }), command('Developer: Reload Window')])
            await page.locator(`.monaco-editor[data-uri=${JSON.stringify(pathToFileURL(probe).href)}]`).waitFor()
          })
          await step('reopen', open)
        }
        await step(`${cycle}-completion`, async () => {
          await edit().focus(); await page.keyboard.press('Control+g'); await query.waitFor({ state: 'visible' })
          await query.fill(`:${fixture.completionPosition}`); await query.press('Enter'); await picker.waitFor({ state: 'hidden' })
          await edit().focus(); await page.keyboard.press('Control+Space')
          const widget = page.locator('.suggest-widget.visible')
          await waitForCompletions(widget, fixture.completions, Date.now() + budget())
          const text = await widget.innerText()
          for (const item of fixture.completions) assert.ok(text.includes(item), `Completion ${item}`)
        })
        await step(`${cycle}-escape`, () => page.keyboard.press('Escape'))
        await step(`${cycle}-invalid`, () => replace(fixture.invalid))
        await step(`${cycle}-errors`, () => page.waitForFunction(() => { const text = document.getElementById('workbench.panel.markers')?.innerText; return text?.includes('2322') && text.includes('typescript(no-floating-promises)') && text.includes('ReviewProbe.tsx') }, undefined, { timeout: budget() }))
        provider(cycle)
        await step(`${cycle}-repair`, () => replace(fixture.valid))
        await step(`${cycle}-clean`, async () => { await page.waitForFunction(() => document.getElementById('workbench.panel.markers')?.innerText.includes('No problems have been detected in the workspace.'), undefined, { timeout: budget() }); assert.equal(await page.getByRole('textbox', { name: 'Filter Problems', exact: true }).inputValue(), '') })
      }
      await browser.close(); browser = undefined
      await owner.cleanup()
      save(join(directory, 'cleanup.json'), { ...json(join(output, 'cleanup.json')), ...await verifyReleased(resource) })
      receipt.cases.push({ name, status: 'PASS', actions, workspace, sdk: receipt.sdk.executable })
      save(join(output, 'receipt.json'), receipt)
    }
    assert.equal(hash(receipt.sdk.executable), receipt.sdk.sha256, 'Vendor binary unchanged')
    receipt.status = 'PASS_ACTUAL_EDITOR_SMOKE'
  } catch (error) {
    receipt.status = 'FAIL'; receipt.error = error.stack
    if (page) {
      await Promise.allSettled([
        page.screenshot({ path: join(output, 'failure.png'), timeout: 3000 }),
        page.locator('body').innerText({ timeout: 3000 }).then(text => writeFileSync(join(output, 'failure.txt'), text)),
      ])
    }
    throw error
  }
  finally {
    clearTimeout(cutoff)
    await browser?.close().catch(() => {})
    try { await owner.cleanup(); receipt.releasedResources = await Promise.all(resources.map(verifyReleased)) }
    catch (error) { receipt.status = 'FAIL'; receipt.cleanupError = error.stack; throw error }
    finally { save(join(output, 'receipt.json'), receipt) }
  }
  console.log(`PASS actual ${receipt.platform} root and frontend editor smoke at ${receipt.sourceSHA}; ${output}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.env.NATIVE_EDITOR_SMOKE_OUTPUT || join(process.env.RUNNER_TEMP || tmpdir(), `qa-scribe-editor-smoke-${Date.now()}`)
  editorSmoke({ source: process.cwd(), output, provision: process.argv.includes('--provision') }).catch(error => { console.error(error); process.exitCode = 1 })
}
