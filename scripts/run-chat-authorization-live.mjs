#!/usr/bin/env node
// Invocation: node scripts/run-chat-authorization-live.mjs --armed [--provider claude|codex]
// Native-app checks use existing CLI accounts and a harmless, process-local MCP
// marker. A nonce journal proves tool execution; only bounded outcome metadata
// is retained. See docs/chat-tool-authorization-plan.md for delivery evidence.
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const cases = Object.freeze(['approve', 'deny', 'cancel'])
const setupCheckpoints = ['settings-availability', 'settings-select', 'settings-save-availability',
  'settings-save', 'settings-canonical-provider', 'settings-canonical-default',
  'settings-refresh-availability', 'settings-refresh', 'settings-readiness', 'settings-cli-version', 'settings-complete']
const setupFlags = ['providerControlEnabled', 'providerOptionAvailable', 'selectionCommitted',
  'saveRequired', 'saveButtonEnabled', 'saveClicked', 'canonicalProviderMatches', 'canonicalModelNull',
  'canonicalProviderModelNull', 'refreshButtonAvailable', 'refreshClicked', 'providerAvailable',
  'providerReady', 'defaultVersionPresent', 'catalogVersionPresent', 'cliVersionPresent']

export function safeSetupEvidence(result) {
  const setup = {}
  for (const key of setupFlags) if (typeof result?.setup?.[key] === 'boolean') setup[key] = result.setup[key]
  return {
    checkpoint: setupCheckpoints.includes(result?.checkpoint) ? result.checkpoint : null,
    setupEvidenceSource: 'native-ui-and-read-only-commands', setup,
    providerState: ['ready', 'authRequired', 'installRequired', 'error'].includes(result?.providerState) ? result.providerState : null,
    cliVersionSource: result?.cliVersionSource === 'installed-cli-version-command' ? result.cliVersionSource : null,
    cliVersion: /^\d+\.\d+\.\d+$/.test(result?.cliVersion ?? '') ? result.cliVersion : null,
  }
}
export const help = 'Usage: node scripts/run-chat-authorization-live.mjs --armed [--provider claude|codex]\n       --help: no build, account access, or network requests\nEvidence: artifacts/chat-authorization-live/<run>/evidence.json\nCopilot deferred (no access); Jira conditional/unexercised (no issue key).\n'

export function parseFlags(args) {
  let armed = false
  let provider = null
  let showHelp = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--armed') armed = true
    else if (args[i] === '--help') showHelp = true
    else if (args[i] === '--provider' && ['claude', 'codex'].includes(args[i + 1])) provider = args[++i]
    else throw new Error('Unsupported flag or provider. Use --help.')
  }
  if (!armed && !showHelp) throw new Error('Live account usage requires explicit --armed consent.')
  return { armed, showHelp, providers: provider ? [provider] : ['claude', 'codex'] }
}

export function resolveExecutable(name, environment = process.env) {
  for (const directory of (environment.PATH ?? '').split(delimiter).filter(Boolean)) {
    try {
      const invocation = resolve(directory, name)
      const binary = realpathSync(invocation)
      accessSync(binary, constants.X_OK)
      if (binary.includes(`${join(root, 'e2e', 'fixtures')}/`)) continue
      // Multi-command shims dispatch using argv[0]; retain the requested alias.
      return invocation
    } catch { /* Try the next PATH candidate, never a shell lookup. */ }
  }
  throw new Error(`An executable real ${name} is required on PATH.`)
}

export function readInstalledCliVersion(binary, environment, spawnSyncImpl = spawnSync) {
  const failure = () => new Error('installed-cli-version-command failed to provide sanitized version metadata.')
  let result
  try {
    result = spawnSyncImpl(binary, ['--version'], { cwd: root, env: environment, shell: false,
      encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024, killSignal: 'SIGKILL' })
  } catch { throw failure() }
  if (result.error || result.status !== 0 || result.signal) throw failure()
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (Buffer.byteLength(output) > 16 * 1024) throw failure()
  // Require a unique standalone numeric SemVer token. Never return raw output,
  // binary paths, labels, exception messages, or prerelease/build suffixes.
  const versions = [...new Set(Array.from(output.matchAll(/(?:^|\s)((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?=\s|$)/g), (match) => match[1]))]
  if (versions.length !== 1) throw failure()
  return versions[0]
}

export function validateCliVersionMetadata(result, observedVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(observedVersion ?? '')
      || result?.cliVersion !== observedVersion || result?.cliVersionSource !== 'installed-cli-version-command') {
    throw new Error('installed-cli-version-command metadata does not match the resolved provider binary.')
  }
}

export function injectionArguments(provider, python, server, marker, journal) {
  if (!['claude', 'codex'].includes(provider)) throw new Error('Unsupported live provider.')
  const env = { QA_SCRIBE_LIVE_MARKER: marker, QA_SCRIBE_LIVE_JOURNAL: journal }
  if (provider === 'claude') return ['--strict-mcp-config', '--mcp-config', JSON.stringify({
    mcpServers: { qa_scribe_probe: { command: python, args: [server], env } },
  })]
  return Object.entries({
    'mcp_servers.qa_scribe_probe.command': python,
    'mcp_servers.qa_scribe_probe.args': [server],
    'mcp_servers.qa_scribe_probe.env': env,
    'mcp_servers.qa_scribe_probe.tools.read_marker.approval_mode': 'prompt',
  }).flatMap(([key, value]) => ['-c', `${key}=${typeof value === 'object' && !Array.isArray(value)
    ? `{ ${Object.entries(value).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }`
    : JSON.stringify(value)}`])
}

export function validateCase(evidence, provider, scenario, journal, nonce) {
  if (!['claude', 'codex'].includes(provider) || !cases.includes(scenario)
      || !/^[a-f0-9]{64}$/.test(nonce) || !evidence || evidence.provider !== provider || evidence.scenario !== scenario
      || evidence.status !== 'passed' || evidence.live !== true || evidence.authenticated !== true
      || evidence.pendingPanel !== true || evidence.nativeJob !== true || evidence.selectedModel !== null
      || evidence.persistence !== true || !/^\d+\.\d+\.\d+$/.test(evidence.cliVersion ?? '')
      || evidence.cliVersionSource !== 'installed-cli-version-command'
      || evidence.appVersionSource !== 'built-workspace-metadata'
      || !/^\d+\.\d+\.\d+$/.test(evidence.appVersion ?? '')) throw new Error('Missing or incomplete native live evidence.')
  const expected = scenario === 'approve' ? 1 : 0
  if (journal.length !== expected || journal.some((call) => call.tool !== 'read_marker'
      || JSON.stringify(call.arguments) !== '{}' || call.nonce !== nonce)) throw new Error('Independent MCP call journal mismatch.')
  if (evidence.markerCalls !== expected || evidence.nonceInFinal !== (scenario === 'approve')
      || evidence.decision !== scenario) throw new Error('UI outcome does not match marker proof.')
  return true
}

function stopGroup(pid) {
  try { process.kill(-pid, 'SIGKILL') } catch { /* Already reaped. */ }
}

async function execute(command, args, env, timeoutMs, groups) {
  const child = spawn(command, args, { cwd: root, env, detached: true, stdio: 'ignore', shell: false })
  if (child.pid) groups.add(child.pid)
  return new Promise((accept, reject) => {
    const timer = setTimeout(() => { if (child.pid) stopGroup(child.pid); reject(new Error('Live harness process timeout.')) }, timeoutMs)
    child.once('error', () => { clearTimeout(timer); reject(new Error('Live harness process could not start.')) })
    child.once('exit', (code) => {
      clearTimeout(timer)
      // Kill surviving descendants even after a successful runner exit.
      if (child.pid) { stopGroup(child.pid); groups.delete(child.pid) }
      if (code === 0) accept(); else reject(new Error('Live harness subprocess failed; no raw account output retained.'))
    })
  })
}

function createWrapper(path, python, binary, injected, pidJournal, environment) {
  // exec replaces the wrapper, preserving the native adapter's process group.
  const accountEnvironment = Object.fromEntries(['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']
    .filter((key) => environment[key] !== undefined).map((key) => [key, environment[key]]))
  const code = `#!${python}\nimport os, sys, json\nfor key in ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']:\n    os.environ.pop(key, None)\nos.environ.update(json.loads(${JSON.stringify(JSON.stringify(accountEnvironment))}))\nwith open(${JSON.stringify(pidJournal)}, 'a') as f:\n    f.write(str(os.getpid()) + '\\n' + str(os.getpgid(os.getppid())) + '\\n')\nextra = json.loads(${JSON.stringify(JSON.stringify(injected))}) if any(x in sys.argv[1:] for x in ['app-server', '--print', '-p']) else []\nos.execv(${JSON.stringify(binary)}, [${JSON.stringify(binary)}] + extra + sys.argv[1:])\n`
  writeFileSync(path, code, { mode: 0o700, flag: 'wx' })
}

export async function runLive(args = process.argv.slice(2), environment = process.env) {
  const flags = parseFlags(args)
  if (flags.showHelp) { process.stdout.write(help); return 0 }
  if (process.platform === 'win32') throw new Error('Live harness currently requires POSIX process groups and Python 3.')
  const binaries = Object.fromEntries(flags.providers.map((provider) => [provider, resolveExecutable(provider, environment)]))
  const python = resolveExecutable('python3', environment)
  const temporary = mkdtempSync(join(tmpdir(), 'qa-scribe-live-'))
  const artifacts = join(root, 'artifacts', 'chat-authorization-live', `${Date.now()}-${randomBytes(4).toString('hex')}`)
  mkdirSync(artifacts, { recursive: true })
  const groups = new Set()
  const pidJournals = []
  const evidence = { live: true, platform: process.platform, architecture: process.arch,
    status: 'failed', requestedProviders: flags.providers,
    outcomes: flags.providers.flatMap((provider) => cases.map((scenario) => ({ provider, scenario, status: 'unexercised' }))),
    copilot: 'deferred-no-access', jira: 'conditional-unexercised-no-issue-key' }
  const cleanupGroups = () => {
    for (const pid of groups) stopGroup(pid)
    groups.clear()
    for (const path of pidJournals) {
      try {
        for (const pid of readFileSync(path, 'utf8').trim().split('\n').map(Number)) if (pid > 1) stopGroup(pid)
        writeFileSync(path, '', { mode: 0o600 })
      } catch { /* No wrapper started. */ }
    }
  }
  const interrupted = () => {
    cleanupGroups()
    rmSync(temporary, { recursive: true, force: true })
    evidence.reason = 'Interrupted before complete authenticated native proof.'
    evidence.temporaryDataRemoved = true
    writeFileSync(join(artifacts, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
    process.exit(130)
  }
  process.once('SIGINT', interrupted)
  process.once('SIGTERM', interrupted)
  try {
    const versions = {}
    evidence.installedCliVersions = {}
    for (const provider of flags.providers) {
      try { versions[provider] = readInstalledCliVersion(binaries[provider], environment) }
      catch {
        evidence.reason = 'installed-cli-version-command failed to provide sanitized version metadata.'
        evidence.cliVersionFailureProvider = provider
        evidence.cliVersionSource = 'installed-cli-version-command'
        throw new Error(evidence.reason)
      }
      evidence.installedCliVersions[provider] = { cliVersion: versions[provider], cliVersionSource: 'installed-cli-version-command' }
    }
    const tauri = JSON.parse(readFileSync(join(root, 'e2e', 'tauri.e2e.conf.json'), 'utf8'))
    const workspace = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
    const appVersion = tauri.version ?? workspace.version
    if (!/^\d+\.\d+\.\d+$/.test(appVersion ?? '')) throw new Error('Invalid workspace app version metadata.')
    // Pin the effective build configuration to the exact metadata reported to
    // the spec. No runtime version permission or product capability is needed.
    tauri.version = appVersion
    tauri.build.frontendDist = join(temporary, 'frontend-dist')
    const buildEnv = { ...environment, TAURI_CONFIG: JSON.stringify(tauri), VITE_QA_SCRIBE_E2E: '1' }
    await execute('bun', ['run', '--cwd', 'frontend', 'build', '--', '--outDir', tauri.build.frontendDist, '--emptyOutDir'], buildEnv, 300_000, groups)
    await execute('cargo', ['build', '--package', 'qa-scribe-tauri', '--features', 'e2e'], buildEnv, 900_000, groups)
    evidence.appVersion = appVersion
    evidence.appVersionSource = 'built-workspace-metadata'
    for (const provider of flags.providers) for (const scenario of cases) {
      const index = evidence.outcomes.findIndex((outcome) => outcome.provider === provider && outcome.scenario === scenario)
      const directory = join(temporary, `${provider}-${scenario}`)
      const wrappers = join(directory, 'bin')
      mkdirSync(wrappers, { recursive: true })
      for (const name of ['app-data', 'home', 'config', 'data', 'cache']) mkdirSync(join(directory, name))
      const marker = join(directory, 'marker')
      const journal = join(directory, 'calls.jsonl')
      const pidJournal = join(directory, 'pids')
      pidJournals.push(pidJournal)
      const nonce = randomBytes(32).toString('hex')
      writeFileSync(marker, nonce, { mode: 0o600 })
      writeFileSync(journal, '', { mode: 0o600 })
      createWrapper(join(wrappers, provider), python, binaries[provider], injectionArguments(provider,
        python, join(root, 'e2e', 'fixtures', 'live-mcp-marker.py'), marker, journal), pidJournal, environment)
      // Native discovery enumerates all providers. Never start Copilot or a
      // nonselected authenticated provider merely to populate Settings.
      for (const other of ['claude', 'codex', 'copilot'].filter((name) => name !== provider)) {
        writeFileSync(join(wrappers, other), `#!${python}\nimport sys\nsys.exit(1)\n`, { mode: 0o700 })
      }
      const resultPath = join(directory, 'result.json')
      const env = { ...environment, QA_SCRIBE_E2E_SPEC: 'chat-authorization-live.e2e.mjs',
        HOME: join(directory, 'home'), XDG_CONFIG_HOME: join(directory, 'config'),
        XDG_DATA_HOME: join(directory, 'data'), XDG_CACHE_HOME: join(directory, 'cache'),
        QA_SCRIBE_E2E_PROVIDER_PATH: wrappers, PATH: `${wrappers}${delimiter}${environment.PATH ?? ''}`,
        QA_SCRIBE_E2E_APP_DATA_DIR: join(directory, 'app-data'), QA_SCRIBE_E2E_ARTIFACTS: directory,
        QA_SCRIBE_E2E_BINARY: join(root, 'target', 'debug', 'qa-scribe-tauri'),
        QA_SCRIBE_LIVE_ARMED: '1', QA_SCRIBE_LIVE_PROVIDER: provider, QA_SCRIBE_LIVE_CASE: scenario,
        QA_SCRIBE_LIVE_APP_VERSION: appVersion,
        QA_SCRIBE_LIVE_CLI_VERSION: versions[provider],
        QA_SCRIBE_LIVE_MARKER: marker, QA_SCRIBE_LIVE_JOURNAL: journal, QA_SCRIBE_LIVE_RESULT: resultPath }
      delete env.CODEX_HOME
      delete env.CLAUDE_CONFIG_DIR
      try {
        await execute(join(root, 'frontend', 'node_modules', '.bin', 'wdio'), ['run', join(root, 'e2e', 'wdio.live.conf.mjs')], env, 360_000, groups)
        const result = JSON.parse(readFileSync(resultPath, 'utf8'))
        const calls = readFileSync(journal, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
        validateCase(result, provider, scenario, calls, nonce)
        validateCliVersionMetadata(result, versions[provider])
        if (result.appVersion !== appVersion) throw new Error('Case app version does not match the fresh build metadata.')
        // These independently validated journal entries contain only the local
        // tool, empty arguments, and random nonce, not account/provider output.
        evidence.outcomes[index] = { ...result, markerNonce: nonce, markerJournal: calls, markerVerified: true }
      } catch {
        let stage = 'missing-evidence'
        let setupEvidence = safeSetupEvidence(null)
        try {
          const result = JSON.parse(readFileSync(resultPath, 'utf8'))
          if (['native-app', 'settings', 'send', 'pending', 'decision', 'terminal', 'durable', 'reload', 'complete'].includes(result.stage)) stage = result.stage
          setupEvidence = safeSetupEvidence(result)
        } catch { /* Zero-exit skipped specs also reach this failure path. */ }
        evidence.outcomes[index] = { provider, scenario, status: 'failed', markerVerified: false,
          stage, ...setupEvidence,
          reason: 'Native case or mandatory independent evidence check failed.' }
      } finally { cleanupGroups() }
    }
    if (evidence.outcomes.length === flags.providers.length * cases.length && evidence.outcomes.every((outcome) => outcome.status === 'passed')) evidence.status = 'passed'
  } catch { evidence.reason ??= 'Build or harness setup failed; no raw account output retained.' }
  finally {
    cleanupGroups()
    rmSync(temporary, { recursive: true, force: true })
    process.removeListener('SIGINT', interrupted)
    process.removeListener('SIGTERM', interrupted)
    evidence.temporaryDataRemoved = true
    writeFileSync(join(artifacts, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
    console.log(`Live authorization ${evidence.status}: ${join(artifacts, 'evidence.json')}`)
  }
  return evidence.status === 'passed' ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runLive().then((code) => { process.exitCode = code }).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
