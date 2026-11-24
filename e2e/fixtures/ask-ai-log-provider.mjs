import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { record } from './chat-authorization-common.mjs'

export const logTool = 'query_application_logs'
export const label = 'Checkout acceptance'
export const start = '2026-11-24T10:00:00Z'
export const end = '2026-11-24T10:15:00Z'
export const approvedKql = "traces | where message == 'checkout café'"

const field = (prompt, key) => JSON.parse(prompt.match(new RegExp(`\\n${key}\\n([^\\n]+)`))[1])

function relayConfig(provider, argv) {
  const tokenName = 'QA_SCRIBE_LOG_MCP_TOKEN'
  let config
  if (provider === 'claude') {
    assert.ok(!argv.includes('--strict-mcp-config'))
    const path = argv[argv.indexOf('--mcp-config') + 1]
    assert.equal(statSync(path).mode & 0o777, 0o600)
    const entries = Object.entries(JSON.parse(readFileSync(path, 'utf8')).mcpServers)
    assert.equal(entries.length, 1)
    const [server, entry] = entries[0]
    assert.ok(argv.includes(`mcp__${server}__${logTool}`))
    config = entry
  } else {
    const overrides = argv.flatMap((arg) => arg.startsWith('mcp_servers.qa_logs_') ? [arg.split(/=(.*)/s)] : [])
    assert.ok(overrides.length)
    const fields = Object.fromEntries(overrides.map(([key, value]) => [key.split('.').slice(2).join('.'), JSON.parse(value)]))
    assert.deepEqual(fields.enabled_tools, [logTool])
    assert.ok(fields.tool_timeout_sec > 120)
    assert.deepEqual(fields.env_vars, [tokenName])
    assert.equal(fields[`tools.${logTool}.approval_mode`], 'approve')
    config = { ...fields, env: { [tokenName]: process.env[tokenName] } }
  }
  assert.equal(config.args[0], '--mcp-logs')
  assert.ok(config.env[tokenName] && !argv.some((arg) => arg.includes(config.env[tokenName])))
  return config
}

async function invokeRelay(config, onCall) {
  const child = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  let id = 0
  const send = (method, params, requestId) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params, id: requestId })}\n`)
  const rpc = async (method, params) => {
    send(method, params, ++id)
    const { value, done } = await lines.next()
    assert.ok(!done, 'The app-owned relay ended before replying')
    const reply = JSON.parse(value)
    assert.equal(reply.id, id)
    assert.ok(!reply.error, JSON.stringify(reply.error))
    return reply.result
  }
  try {
    assert.equal((await rpc('initialize', { protocolVersion: '2025-11-25' })).protocolVersion, '2025-11-25')
    send('notifications/initialized')
    assert.deepEqual((await rpc('tools/list')).tools.map((tool) => tool.name), [logTool])
    return await onCall((kql) => rpc('tools/call', { name: logTool, arguments: { target: label, kql, start, end } }))
  } finally {
    child.stdin.end()
  }
}

export async function logTurn(provider, argv, prompt) {
  const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
  const contract = field(prompt, 'CHAT_RESPONSE_CONTRACT_JSON')
  const report = field(prompt, 'TEST_RUN_REPORT_JSON')
  const captures = field(prompt, 'APPROVED_APPLICATION_LOG_CAPTURES_JSON')
  assert.equal(contract.purpose.kind, 'test_run_recording')
  assert.deepEqual(field(prompt, 'APPLICATION_LOG_TARGETS_JSON'), [label])
  assert.ok(prompt.includes('Never suggest Passed based only on logs'))
  const envelope = { version: contract.version, requestId: contract.requestId }
  if (prompt.includes('Can you reuse the approved log?')) {
    assert.equal(captures.length, 1)
    assert.equal(captures[0].result.tables[0].rows[0][0], 'fixture checkout trace')
    record(directory, 'replay.json', captures)
    return JSON.stringify({ ...envelope, markdown: 'I can reuse the approved capture.' })
  }
  assert.deepEqual(captures, [])
  const result = await invokeRelay(relayConfig(provider, argv), async (call) => {
    const approved = await call(approvedKql)
    assert.ok(!approved.isError)
    const result = JSON.parse(approved.content[0].text)
    assert.equal(result.result.tables[0].rows[0][0], 'fixture checkout trace')
    assert.ok(result.portalUrl.startsWith('https://portal.azure.com/'))
    assert.deepEqual([result.target, result.start, result.end, result.rowCount, result.truncated], [label, start, end, 1, false])
    const denied = await call("traces | where message == 'denied'")
    assert.equal(denied.isError, true)
    assert.match(denied.content[0].text, /denied/)
    return result
  })
  record(directory, 'relay.json', result)
  const caseId = report.match(/\(TC 2 \[([a-f0-9-]+)\]\)/)[1]
  return JSON.stringify({ ...envelope, markdown: 'Review the application log capture for TC 2.',
    testRunSuggestions: [{ caseId, captureIds: [result.captureId] }] })
}
