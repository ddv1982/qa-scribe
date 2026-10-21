import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertRustSdkPrepared, resolveRustSdk } from './rust-typescript-sdk.mjs'

const shutdownEOF = "error handling method 'exit': EOF"

export async function checkRustLsp(frontend) {
  const sdk = resolveRustSdk(frontend)
  assertRustSdkPrepared(sdk)
  const executableSHA256 = createHash('sha256').update(readFileSync(sdk.executable)).digest('hex')
  const child = spawn(sdk.executable, ['--lsp', '--stdio'], { cwd: frontend, env: { LANG: 'C', PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] })
  let phase = 'initialize-pending', firstFailure, stopped, initialized, timer, failureSignal
  let buffer = Buffer.alloc(0), stderr = '', stdoutBytes = 0
  const messages = [], sent = [], stdout = []
  const failed = new Promise(resolve => { failureSignal = resolve })
  const fail = error => {
    if (!firstFailure) { firstFailure = { error, phase }; failureSignal() }
  }
  const armTimeout = label => {
    clearTimeout(timer)
    timer = setTimeout(() => fail(new Error(`Rust LSP ${label} exceeded ten seconds`)), 10_000)
  }
  const closed = new Promise(resolve => child.once('close', (code, signal) => { stopped = { code, signal }; resolve() }))
  const send = (message, nextPhase) => {
    if (firstFailure) return
    const body = JSON.stringify(message)
    try {
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, error => {
        if (error) { fail(error); return }
        sent.push(message)
        if (nextPhase && !firstFailure) phase = nextPhase
      })
    } catch (error) { fail(error) }
  }
  const receive = message => {
    assert.ok(message && typeof message === 'object' && !Array.isArray(message) && message.jsonrpc === '2.0', 'Malformed Rust LSP JSON-RPC message')
    assert.ok(!Object.hasOwn(message, 'error'), 'Rust LSP error response')
    if (Object.hasOwn(message, 'method')) {
      assert.ok(typeof message.method === 'string' && !Object.hasOwn(message, 'result'), 'Malformed Rust LSP method message')
      if (Object.hasOwn(message, 'id')) {
        assert.ok((typeof message.id === 'string' && message.id.length > 0) || Number.isSafeInteger(message.id), 'Malformed Rust LSP request id')
        assert.equal(message.method, 'client/registerCapability', 'Unexpected Rust LSP client request')
        assert.ok(phase !== 'initialize-pending' && phase !== 'initialize-sent' && phase !== 'exit-sent', 'Rust LSP registration outside initialization')
        assert.ok(Array.isArray(message.params?.registrations) && message.params.registrations.every(row => row && typeof row.id === 'string' && typeof row.method === 'string'), 'Malformed Rust LSP registration')
        send({ jsonrpc: '2.0', id: message.id, result: null })
      } else {
        assert.equal(message.method, 'window/logMessage', 'Unexpected Rust LSP notification')
        const params = message.params
        assert.ok(params && Number.isInteger(params.type) && params.type >= 1 && params.type <= 4 && typeof params.message === 'string', 'Malformed Rust LSP log message')
        if (params.type === 1) assert.ok(phase === 'exit-sent' && params.message === shutdownEOF && Object.keys(params).length === 2, `Rust LSP error log: ${params.message}`)
      }
      return
    }
    assert.ok(Object.hasOwn(message, 'result'), 'Malformed Rust LSP response')
    if (message.id === 1) {
      assert.equal(phase, 'initialize-sent', 'Rust LSP initialize response out of order')
      assert.ok(message.result && typeof message.result.capabilities === 'object' && message.result.capabilities !== null && !Array.isArray(message.result.capabilities), 'Rust LSP must initialize successfully')
      initialized = message.result
      phase = 'shutdown-pending'
      armTimeout('shutdown/exit')
      send({ jsonrpc: '2.0', method: 'initialized', params: {} })
      send({ jsonrpc: '2.0', id: 2, method: 'shutdown' }, 'shutdown-sent')
    } else if (message.id === 2) {
      assert.equal(phase, 'shutdown-sent', 'Rust LSP shutdown response out of order')
      assert.equal(message.result, null, 'Rust LSP shutdown acknowledgement must be null')
      phase = 'exit-pending'
      send({ jsonrpc: '2.0', method: 'exit' }, 'exit-sent')
    } else throw new Error(`Unexpected Rust LSP response id ${message.id}`)
  }
  child.once('error', fail)
  child.stdin.on('error', fail)
  child.stdout.on('error', fail)
  child.stderr.on('error', fail)
  child.stderr.on('data', data => {
    stderr += data.toString()
    if (Buffer.byteLength(stderr) > 1_000_000) { stderr = stderr.slice(0, 1_000_000); fail(new Error('Rust LSP stderr limit')) }
  })
  child.stdout.on('data', data => {
    stdoutBytes += data.length
    if (stdoutBytes > 8_000_000) { fail(new Error('Rust LSP response limit')); return }
    stdout.push(data)
    if (firstFailure) return
    try {
      buffer = Buffer.concat([buffer, data])
      for (;;) {
        const end = buffer.indexOf('\r\n\r\n'); if (end < 0) break
        const headers = buffer.subarray(0, end).toString().split('\r\n')
        assert.ok(headers.every(header => /^[A-Za-z-]+: [^\r\n]+$/.test(header)), 'Malformed Rust LSP header')
        const lengths = headers.filter(header => /^Content-Length:/i.test(header))
        assert.equal(lengths.length, 1, 'Rust LSP needs exactly one Content-Length header')
        const length = /^Content-Length: (\d+)$/i.exec(lengths[0])
        assert.ok(length && Number.isSafeInteger(Number(length[1])) && Number(length[1]) > 0 && Number(length[1]) <= 8_000_000, 'Invalid Rust LSP Content-Length')
        const size = Number(length[1]); if (buffer.length < end + 4 + size) break
        const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(end + 4, end + 4 + size)))
        buffer = buffer.subarray(end + 4 + size)
        messages.push(message)
        receive(message)
      }
    } catch (error) { fail(error) }
  })
  const stopOwnedChild = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    let grace
    await Promise.race([closed, new Promise(resolve => { grace = setTimeout(resolve, 1000) })]); clearTimeout(grace)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await closed
  }
  try {
    armTimeout('initialize')
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: pathToFileURL(frontend).href, capabilities: {} } }, 'initialize-sent')
    await Promise.race([closed, failed])
    if (firstFailure) await stopOwnedChild()
    await closed
    let outcome, qualification
    if (!firstFailure) {
      try {
        assert.equal(buffer.length, 0, 'Truncated Rust LSP frame at process close')
        assert.equal(phase, 'exit-sent', 'Rust LSP closed before ordered shutdown acknowledgement and actual exit send')
        assert.equal(stopped.signal, null, 'Rust LSP stopped by an unexpected signal')
        const errors = messages.filter(message => message.method === 'window/logMessage' && message.params.type === 1)
        if (stopped.code === 0) {
          assert.equal(stderr, '', 'Unexpected Rust LSP stderr on normal exit')
          assert.equal(errors.length, 0, 'Unexpected Rust LSP error log on normal exit')
          outcome = 'NORMAL_EXIT'
        } else {
          assert.ok(stopped.code === 1 && sdk.umbrella.version === '0.7.0' && sdk.native.version === '0.7.0' && stderr === 'context canceled\n' && errors.length === 1 && errors[0].params.message === shutdownEOF, `Unexpected Rust LSP exit code or shutdown signature: ${stopped.code}`)
          outcome = 'QUALIFIED_PINNED_0_7_0_SHUTDOWN_EOF'
          qualification = "Pinned SDK 0.7.0 acknowledged shutdown, then reported exit EOF and context canceled. This is a known upstream shutdown outcome, not a normal exit."
        }
      } catch (error) { fail(error) }
    }
    const receipt = { sdk, executableSHA256, pid: child.pid, initialized, stopped, phase, sent, stderr, stdout: Buffer.concat(stdout).toString(), messages, outcome: firstFailure ? 'FAIL' : outcome, ...(qualification ? { qualification } : {}) }
    if (firstFailure) {
      receipt.firstFailure = { message: firstFailure.error.message, phase: firstFailure.phase, ...(firstFailure.error.code ? { code: firstFailure.error.code } : {}) }
      receipt.error = firstFailure.error.message
      firstFailure.error.receipt = receipt
      throw firstFailure.error
    }
    return receipt
  } finally { clearTimeout(timer); await stopOwnedChild() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv.length === 2 || process.argv.length === 3, 'Usage: node scripts/check-rust-typescript-lsp.mjs [receipt.json]')
    const receipt = await checkRustLsp(fileURLToPath(new URL('../frontend', import.meta.url)))
    if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(receipt, null, 2)}\n`)
    const status = receipt.outcome === 'NORMAL_EXIT' ? 'PASS NORMAL_EXIT' : 'QUALIFIED PINNED_0_7_0_SHUTDOWN_EOF'
    console.log(`${status}: initialize/shutdown replies from ${receipt.sdk.native.name}@${receipt.sdk.native.version}; exit sent; owned child ${receipt.pid} stopped with actual code ${receipt.stopped.code}${receipt.qualification ? '; ' + receipt.qualification : ''}`)
  } catch (error) {
    if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(error.receipt ?? { outcome: 'FAIL', error: error.message }, null, 2)}\n`)
    console.error(`FAIL: ${error.message}`); process.exitCode = 1
  }
}
