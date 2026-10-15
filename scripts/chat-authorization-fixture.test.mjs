import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))

function appServer(directory, provider = 'codex', authorization = false) {
  const argv = { codex: ['app-server', '--enable', 'tool_call_mcp_elicitation'],
    claude: ['--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-prompt-tool', 'stdio'],
    copilot: ['--acp'] }[provider]
  const child = spawn(process.execPath, [resolve(root, `e2e/fixtures/bin/${provider}`), ...argv], {
    env: { ...process.env, QA_SCRIBE_E2E_FIXTURE_DIR: directory,
      QA_SCRIBE_E2E_AUTH_PROVIDER: authorization ? provider : '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const events = []
  let buffered = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffered += chunk
    const lines = buffered.split('\n')
    buffered = lines.pop()
    for (const line of lines.filter(Boolean)) events.push(JSON.parse(line))
  })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return {
    child,
    events,
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    async receive(predicate, description) {
      const deadline = Date.now() + 1_500
      while (Date.now() < deadline) {
        const event = events.find(predicate)
        if (event) return event
        if (child.exitCode !== null) assert.fail(`Fixture exited: ${stderr}`)
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
      }
      assert.fail(`Timed out waiting for ${description}; stderr=${stderr}; events=${JSON.stringify(events)}`)
    },
  }
}

async function beginAuthorization(running, provider, prompt) {
  if (provider === 'claude') {
    running.send({ type: 'control_request', request_id: 'qa-scribe-init', request: { subtype: 'initialize' } })
    await running.receive((event) => event.type === 'control_response', 'Claude initialization')
    running.send({ type: 'user', message: { role: 'user', content: prompt } })
  } else {
    running.send({ id: 'qa-scribe-init', method: 'initialize', params: { protocolVersion: 1 } })
    await running.receive((event) => event.id === 'qa-scribe-init', `${provider} initialization`)
    const method = provider === 'codex' ? 'thread/start' : 'session/new'
    running.send({ id: 'fixture-scope', method, params: { ephemeral: true, cwd: root, mcpServers: [] } })
    const scope = (await running.receive((event) => event.id === 'fixture-scope', `${provider} scope`)).result
    running.send(provider === 'codex'
      ? { id: 'fixture-turn', method: 'turn/start', params: { threadId: scope.thread.id, input: [{ type: 'text', text: prompt }] } }
      : { id: 'fixture-turn', method: 'session/prompt', params: { sessionId: scope.sessionId, prompt: [{ type: 'text', text: prompt }] } })
  }
}

for (const provider of ['codex', 'claude', 'copilot']) {
  for (const decision of ['approve', 'deny', 'cancel', 'policy']) {
    test(`${provider} native fixture ${decision} controls actual marker child execution`, { timeout: 7_000 }, async () => {
      const directory = mkdtempSync(join(tmpdir(), `qa-scribe-${provider}-authorization-`))
      writeFileSync(join(directory, 'authorization-case.json'), JSON.stringify({ mode: decision === 'policy' ? 'policy' : 'permission' }))
      const running = appServer(directory, provider, true)
      const prompt = 'QA_SCRIBE_CHAT_V2\nTRANSCRIPT_JSON\n{"messages":[{"role":"user","text":"Original authorization evidence"}]}'
      const markerPath = join(directory, `${provider}-auth-1.executed.json`)
      try {
        await beginAuthorization(running, provider, prompt)
        if (decision !== 'policy') {
          const request = await running.receive((event) => event.id === 'fixture-permission' || event.request_id === 'fixture-permission', 'native permission request')
          assert.equal(existsSync(markerPath), false, 'The child must not execute before a decision')
          if (decision === 'cancel') {
            running.child.kill('SIGTERM')
            await new Promise((resolvePromise) => running.child.once('close', resolvePromise))
          } else if (provider === 'claude') {
            running.send({ type: 'control_response', response: { subtype: 'success', request_id: 'fixture-permission',
              response: decision === 'approve' ? { behavior: 'allow', updatedInput: request.request.input }
                : { behavior: 'deny', message: 'User denied permission' } } })
          } else if (provider === 'codex') {
            running.send({ id: 'fixture-permission', result: { action: decision === 'approve' ? 'accept' : 'decline', content: {} } })
          } else {
            running.send({ jsonrpc: '2.0', id: 'fixture-permission', result: { outcome: {
              outcome: 'selected', optionId: decision === 'approve' ? 'approve-marker' : 'deny-marker',
            } } })
          }
        }
        if (decision !== 'cancel') {
          await running.receive((event) => event.method === 'turn/completed' || event.type === 'result'
            || (provider === 'copilot' && event.id === 'fixture-turn'), 'authorization completion')
        }
        assert.equal(JSON.parse(readFileSync(join(directory, `${provider}-auth-1.prompt.json`), 'utf8')).prompt, prompt)
        assert.equal(existsSync(markerPath), decision === 'approve')
        if (decision === 'approve') {
          const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
          assert.equal(marker.parent, running.child.pid)
          assert.notEqual(marker.pid, running.child.pid)
        }
        if (decision === 'policy') {
          assert.equal(running.events.some((event) => event.id === 'fixture-permission' || event.request_id === 'fixture-permission'), false)
        }
      } finally {
        if (running.child.exitCode === null && running.child.signalCode === null) {
          running.child.kill('SIGKILL')
          await new Promise((resolvePromise) => running.child.once('close', resolvePromise))
        }
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
}

for (const provider of ['codex', 'claude', 'copilot']) {
  test(`${provider} bulk fixture correlates a burst and emits a later permission after three once replies`, { timeout: 7_000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), `qa-scribe-${provider}-bulk-`))
    writeFileSync(join(directory, 'authorization-case.json'), JSON.stringify({ mode: 'bulk' }))
    const running = appServer(directory, provider, true)
    try {
      await beginAuthorization(running, provider, 'Bulk authorization fixture evidence')
      await running.receive((event) => (event.request_id ?? event.id) === 'fixture-permission-1-3', 'initial burst')
      assert.equal(existsSync(join(directory, `${provider}-auth-1.request-4.json`)), false)
      for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
        const id = `fixture-permission-1-${ordinal}`
        const request = await running.receive((event) => (event.request_id ?? event.id) === id, `permission ${ordinal}`)
        const marker = join(directory, `${provider}-auth-1.tool-${ordinal}.executed.json`)
        assert.equal(existsSync(marker), false)
        running.send(provider === 'claude'
          ? { type: 'control_response', response: { subtype: 'success', request_id: id,
            response: { behavior: 'allow', updatedInput: request.request.input } } }
          : provider === 'codex' ? { id, result: { action: 'accept', content: {} } }
            : { jsonrpc: '2.0', id, result: { outcome: { outcome: 'selected', optionId: `approve-marker-${id}` } } })
        const deadline = Date.now() + 1_500
        while (!existsSync(marker) && Date.now() < deadline) await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
        const child = JSON.parse(readFileSync(marker, 'utf8'))
        assert.equal(child.parent, running.child.pid)
        assert.notEqual(child.pid, running.child.pid)
        if (ordinal < 3) assert.equal(existsSync(join(directory, `${provider}-auth-1.request-4.json`)), false)
      }
      await running.receive((event) => event.method === 'turn/completed' || event.type === 'result'
        || (provider === 'copilot' && event.id === 'fixture-turn'), 'bulk completion')
    } finally {
      if (running.child.exitCode === null && running.child.signalCode === null) {
        running.child.kill('SIGKILL')
        await new Promise((resolvePromise) => running.child.once('close', resolvePromise))
      }
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

for (const ids of [
  ['qa-scribe-init', 'qa-scribe-thread', 'qa-scribe-turn'],
  [41, 73, 109],
]) {
  test(`Codex app-server stages the original Chat prompt with dynamic IDs ${ids.join('/')}`,
    { timeout: 7_000 }, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-chat-app-server-'))
      const running = appServer(directory)
      try {
        const messages = [{ role: 'user', text: 'Checkout failed\nKeep the original evidence: 雪.' }]
        const version = readFileSync(join(root, 'crates/qa-scribe-core/src/chat/mod.rs'), 'utf8')
          .match(/CHAT_PROMPT_VERSION: &str = "([^"]+)"/)[1]
        const prompt = `${version}\nTRANSCRIPT_JSON\n${JSON.stringify({ sessionContext: '', messages })}`
        running.send({ id: ids[0], method: 'initialize', params: {
          clientInfo: { name: 'qa-scribe', version: '0.1.0' },
        } })
        assert.deepEqual((await running.receive((event) => event.id === ids[0], 'initialize response')).result, {})
        running.send({ method: 'initialized' })
        running.send({ id: ids[1], method: 'thread/start', params: { ephemeral: true, cwd: directory } })
        const thread = await running.receive((event) => event.id === ids[1], 'ephemeral thread response')
        assert.equal(typeof thread.result.thread.id, 'string')
        running.send({ id: ids[2], method: 'turn/start', params: {
          threadId: thread.result.thread.id, input: [{ type: 'text', text: prompt }],
        } })
        const turn = await running.receive((event) => event.id === ids[2], 'turn start response')
        assert.equal(turn.result.turn.status, 'inProgress')
        assert.equal(typeof turn.result.turn.id, 'string')
        // The native Chat-to-Note workflow already synchronizes on these names.
        const started = readFileSync(join(directory, 'codex-exec-1.started'), 'utf8')
        assert.equal(Number(started.trim()), running.child.pid)
        const recorded = JSON.parse(readFileSync(join(directory, 'codex-exec-1.chat.json'), 'utf8'))
        assert.deepEqual(recorded.messages, messages)
        assert.equal(recorded.response, 'Which build and environment did you test?')
        assert.ok(recorded.argv.includes('app-server'))
        assert.equal(JSON.parse(readFileSync(join(directory, 'codex-exec-1.prompt.json'), 'utf8')).prompt, prompt,
          'The original prompt must reach the turn unchanged')
        assert.equal(running.events.some((event) => event.method === 'turn/completed'), false)
        writeFileSync(join(directory, 'codex-exec-1.release'), 'released by fixture test\n', { flag: 'wx' })
        const completed = await running.receive((event) => event.method === 'turn/completed', 'released turn completion')
        assert.equal(completed.params.threadId, thread.result.thread.id)
        assert.equal(completed.params.turn.id, turn.result.turn.id)
        assert.equal(completed.params.turn.status, 'completed')
        const deltas = running.events.filter((event) => event.method === 'item/agentMessage/delta')
        assert.equal(deltas.map((event) => event.params.delta).join(''), recorded.response)
      } finally {
        running.child.kill('SIGKILL')
        await new Promise((resolvePromise) => {
          if (running.child.exitCode !== null || running.child.signalCode !== null) resolvePromise()
          else running.child.once('close', resolvePromise)
        })
        rmSync(directory, { recursive: true, force: true })
      }
    })
}
