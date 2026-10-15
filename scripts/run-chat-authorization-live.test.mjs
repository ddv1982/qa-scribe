import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cases, injectionArguments, parseFlags, readInstalledCliVersion, resolveExecutable, safeSetupEvidence, validateCase, validateCliVersionMetadata } from './run-chat-authorization-live.mjs'

test('executable discovery preserves the invocation name of multi-command symlink shims', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-cli-alias-'))
  try {
    const alias = join(directory, 'codex')
    symlinkSync(process.execPath, alias)
    assert.equal(resolveExecutable('codex', { PATH: directory }), alias)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('live account usage is explicit and flag surface is bounded', () => {
  assert.throws(() => parseFlags([]), /--armed/)
  assert.deepEqual(parseFlags(['--armed']).providers, ['claude', 'codex'])
  assert.deepEqual(parseFlags(['--armed', '--provider', 'claude']).providers, ['claude'])
  assert.deepEqual(parseFlags(['--armed', '--provider', 'codex']).providers, ['codex'])
  assert.equal(parseFlags(['--help']).showHelp, true)
  for (const args of [['--provider', 'copilot'], ['--armed', '--skip-build'], ['--armed', '--model', 'gpt-5.4'], ['--armed', '--provider']]) {
    assert.throws(() => parseFlags(args), /Unsupported/)
  }
})

test('process-only MCP injection neither selects models nor grants tools blanket access', () => {
  const claude = injectionArguments('claude', '/python', '/server', '/marker', '/journal')
  assert.deepEqual(claude.slice(0, 3), ['--strict-mcp-config', '--mcp-config', claude[2]])
  assert.deepEqual(Object.keys(JSON.parse(claude[2]).mcpServers), ['qa_scribe_probe'])
  const codex = injectionArguments('codex', '/python', '/server', '/marker', '/journal')
  assert.ok(codex.includes('mcp_servers.qa_scribe_probe.tools.read_marker.approval_mode="prompt"'))
  for (const args of [claude, codex]) assert.doesNotMatch(args.join(' '), /bypass|dangerously|allowedTools|allowrules|--model|gpt-5\.4/)
})

const complete = (scenario) => ({ provider: 'claude', scenario, status: 'passed', live: true,
  authenticated: true, pendingPanel: true, nativeJob: true, selectedModel: null, persistence: true,
  cliVersion: '2.1.299', cliVersionSource: 'installed-cli-version-command', appVersion: '0.8.1', appVersionSource: 'built-workspace-metadata', markerCalls: scenario === 'approve' ? 1 : 0,
  nonceInFinal: scenario === 'approve', decision: scenario })
const call = { tool: 'read_marker', arguments: {}, nonce: 'ab'.repeat(32) }

test('zero-exit skipped specs or model-only claims cannot satisfy mandatory evidence', () => {
  assert.throws(() => validateCase(null, 'claude', 'approve', [], call.nonce))
  assert.throws(() => validateCase(complete('approve'), 'claude', 'approve', [], call.nonce))
  for (const scenario of cases) {
    const journal = scenario === 'approve' ? [call] : []
    assert.equal(validateCase(complete(scenario), 'claude', scenario, journal, call.nonce), true)
    for (const field of ['live', 'authenticated', 'pendingPanel', 'nativeJob', 'persistence']) {
      assert.throws(() => validateCase({ ...complete(scenario), [field]: false }, 'claude', scenario, journal, call.nonce))
    }
  }
})

test('journal rejects duplicate, unexpected, malformed, denied or cancelled tool execution', () => {
  for (const journal of [[call, call], [{ ...call, nonce: 'invented' }], [{ ...call, tool: 'jira' }], [{ ...call, arguments: { path: '/secret' } }]]) {
    assert.throws(() => validateCase(complete('approve'), 'claude', 'approve', journal, call.nonce))
  }
  for (const scenario of ['deny', 'cancel']) assert.throws(() => validateCase(complete(scenario), 'claude', scenario, [call], call.nonce))
  assert.throws(() => validateCase({ ...complete('approve'), selectedModel: 'gpt-5.4' }, 'claude', 'approve', [call], call.nonce))
})

test('setup uses native form commit and fresh build metadata without runtime version permissions', () => {
  const spec = readFileSync(new URL('../e2e/specs/chat-authorization-live.e2e.mjs', import.meta.url), 'utf8')
  const helper = readFileSync(new URL('./run-chat-authorization-live.mjs', import.meta.url), 'utf8')
  assert.match(spec, /select\.selectByAttribute\('value', providerId\)/)
  assert.match(spec, /Object\.getOwnPropertyDescriptor\(HTMLSelectElement\.prototype, 'value'\)/)
  for (const event of ['input', 'change']) assert.ok(spec.includes(`new Event('${event}', { bubbles: true })`))
  assert.match(spec, /assert\.equal\(settings\.selectedAiProvider, providerId/)
  assert.doesNotMatch(spec, /plugin:app\|version|Reset to CLI default|read\('update_settings'/)
  assert.match(helper, /tauri\.version = appVersion/)
  assert.match(helper, /QA_SCRIBE_LIVE_APP_VERSION: appVersion/)
  assert.match(spec, /\[aria-label="Refresh CLI configuration"\]/)
  assert.match(spec, /await refresh\.click\(\)/)
  assert.match(spec, /status\?\.catalogSnapshot\?\.cliVersion/)
  assert.match(spec, /evidence\.cliVersion = process\.env\.QA_SCRIBE_LIVE_CLI_VERSION/)
  assert.doesNotMatch(spec, /return evidence\.setup\.cliVersionPresent|await observedProvider\(\) && evidence\.setup\.cliVersionPresent/)
  assert.throws(() => validateCase({ ...complete('approve'), appVersionSource: 'native-api' }, 'claude', 'approve', [call], call.nonce))
  assert.throws(() => validateCase({ ...complete('approve'), appVersionSource: undefined }, 'claude', 'approve', [call], call.nonce))
})

test('failed setup metadata retains only checkpoint enums, booleans, and sanitized native version provenance', () => {
  const diagnostic = safeSetupEvidence({ checkpoint: 'settings-cli-version', providerState: 'ready',
    cliVersionSource: 'installed-cli-version-command', cliVersion: '0.162.1',
    setup: { refreshClicked: true, providerReady: true, defaultVersionPresent: false,
      catalogVersionPresent: true, saveClicked: 'account-secret', rawError: '/private/account' },
    error: 'private account error', modelText: 'private model text' })
  assert.deepEqual(diagnostic, { checkpoint: 'settings-cli-version', setupEvidenceSource: 'native-ui-and-read-only-commands',
    setup: { refreshClicked: true, providerReady: true, defaultVersionPresent: false, catalogVersionPresent: true },
    providerState: 'ready', cliVersionSource: 'installed-cli-version-command', cliVersion: '0.162.1' })
  assert.deepEqual(safeSetupEvidence({ checkpoint: '/private/account', providerState: 'username',
    cliVersionSource: 'fake', cliVersion: '0.162.1 /private/account', setup: { saveClicked: 'secret' } }),
  { checkpoint: null, setupEvidenceSource: 'native-ui-and-read-only-commands', setup: {},
    providerState: null, cliVersionSource: null, cliVersion: null })
})

test('installed binary version probe is bounded, uses original environment, and returns only numeric metadata', () => {
  const environment = { HOME: '/original-home', PATH: '/original-path' }
  for (const [stdout, version] of [['2.1.299 (Claude Code)\n', '2.1.299'], ['codex-cli 0.162.1\n', '0.162.1']]) {
    assert.equal(readInstalledCliVersion('/resolved/cli', environment, (binary, args, options) => {
      assert.equal(binary, '/resolved/cli')
      assert.deepEqual(args, ['--version'])
      assert.equal(options.env, environment)
      assert.equal(options.timeout, 10_000)
      assert.equal(options.maxBuffer, 16 * 1024)
      assert.equal(options.shell, false)
      return { status: 0, stdout, stderr: 'private-account-label' }
    }), version)
  }
  for (const result of [{ status: 1, stdout: '2.1.299 private-secret' },
    { status: 0, error: new Error('private-secret') }, { status: null, signal: 'SIGKILL' },
    { status: 0, stdout: 'private-secret' }, { status: 0, stdout: '1.2.3 4.5.6 private-secret' },
    { status: 0, stdout: '1.2.3-beta private-secret' }, { status: 0, stdout: 'x'.repeat(16 * 1024 + 1) }]) {
    assert.throws(() => readInstalledCliVersion('/private/path', environment, () => result),
      (error) => error.message === 'installed-cli-version-command failed to provide sanitized version metadata.')
  }
  assert.throws(() => readInstalledCliVersion('/private/path', environment, () => { throw new Error('private-secret') }),
    (error) => error.message === 'installed-cli-version-command failed to provide sanitized version metadata.')
  assert.doesNotMatch(JSON.stringify(safeSetupEvidence({ cliVersion: 'private-secret', cliVersionSource: '/private/path' })), /private-secret|private\/path/)
})

test('R5 version evidence must match the helper observation and installed command provenance', () => {
  const result = complete('approve')
  assert.doesNotThrow(() => validateCliVersionMetadata(result, '2.1.299'))
  for (const candidate of [{ ...result, cliVersion: '2.1.298' }, { ...result, cliVersionSource: 'defaultSnapshot' },
    { ...result, cliVersionSource: undefined }]) {
    assert.throws(() => validateCliVersionMetadata(candidate, '2.1.299'), /installed-cli-version-command metadata/)
  }
  assert.throws(() => validateCase({ ...result, cliVersionSource: 'catalogSnapshot' }, 'claude', 'approve', [call], call.nonce))
})

test('harmless MCP server returns private nonce only for the exact tool and journals every attempt', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-marker-test-'))
  try {
    const marker = join(directory, 'marker')
    const journal = join(directory, 'journal')
    writeFileSync(marker, call.nonce)
    writeFileSync(journal, '')
    const requests = [
      { id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { method: 'notifications/initialized' },
      { id: 2, method: 'tools/list' },
      { id: 3, method: 'tools/call', params: { name: 'read_marker', arguments: {} } },
      { id: 4, method: 'tools/call', params: { name: 'other_tool', arguments: {} } },
    ]
    const result = spawnSync('python3', [fileURLToPath(new URL('../e2e/fixtures/live-mcp-marker.py', import.meta.url))], {
      input: requests.map((request) => JSON.stringify({ jsonrpc: '2.0', ...request })).join('\n') + '\n',
      env: { ...process.env, QA_SCRIBE_LIVE_MARKER: marker, QA_SCRIBE_LIVE_JOURNAL: journal }, encoding: 'utf8', timeout: 5_000,
    })
    assert.equal(result.status, 0, result.stderr)
    const frames = result.stdout.trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(frames.length, 4)
    assert.deepEqual(frames[1].result.tools.map((tool) => tool.name), ['read_marker'])
    assert.equal(frames[2].result.content[0].text, call.nonce)
    assert.equal(frames[3].result.isError, true)
    const entries = readFileSync(journal, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(entries, [call, { tool: 'other_tool', arguments: {}, nonce: '' }])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
