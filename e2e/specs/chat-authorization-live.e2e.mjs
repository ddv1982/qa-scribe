import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const provider = process.env.QA_SCRIBE_LIVE_PROVIDER
const scenario = process.env.QA_SCRIBE_LIVE_CASE
const providerId = { claude: 'claude_code', codex: 'codex_cli' }[provider]
const panel = '[aria-label="Tool permission"]'
const prompt = 'Authorization validation only. Call the local MCP server qa_scribe_probe tool read_marker exactly once with empty arguments {}. '
  + 'Return its exact nonce in your final reply. Never invent a nonce. If permission is denied, finish with DENIED and do not retry. '
  + 'Do not call any other tools, connectors, servers, filesystem, shell, Jira, or network services. '
  + 'Only local tool discovery for this exact marker may be used if needed.'

function calls() {
  return readFileSync(process.env.QA_SCRIBE_LIVE_JOURNAL, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

async function read(command, args = {}) {
  // Read-only public native API, all actions go through the actual UI.
  return browser.execute(async (name, parameters) => window.__TAURI_INTERNALS__.invoke(name, parameters), command, args)
}

async function click(label) {
  if (label === 'Configure AI') {
    const options = await $('.ask-ai-panel--notes .chat-options')
    if (!await browser.execute(node => node.open, options)) await (await options.$('summary')).click()
  }
  const target = await $(`button=${label}`)
  await target.waitForClickable()
  await target.click()
}

function expectedTool(permission) {
  return permission?.provider === providerId &&
    (permission.toolName === 'mcp__qa_scribe_probe__read_marker'
      || (permission.serverName === 'qa_scribe_probe' && (permission.toolName === 'read_marker'
        || (permission.toolName == null && /\bread_marker\b/.test(permission.title)))))
    && JSON.stringify(JSON.parse(permission.inputJson ?? '{}')) === '{}'
}

describe('AUTHENTICATED candidate native app Chat authorization (not fixtures)', () => {
  it('requires real UI decisions, independent MCP counts, and durable native transcript', async () => {
    assert.equal(process.env.QA_SCRIBE_LIVE_ARMED, '1')
    assert.ok(providerId && ['approve', 'deny', 'cancel'].includes(scenario))
    const evidence = { provider, scenario, live: true, status: 'failed', authenticated: false,
      pendingPanel: false, nativeJob: false, selectedModel: null, persistence: false,
      markerCalls: null, nonceInFinal: false, decision: null, cliVersion: null, appVersion: null,
      appVersionSource: 'built-workspace-metadata',
      checkpoint: null, setupEvidenceSource: 'native-ui-and-read-only-commands', setup: {},
      providerState: null, cliVersionSource: 'installed-cli-version-command',
      stage: 'native-app', finalTextSha256: null, terminalState: null }
    let jobId
    try {
      evidence.appVersion = process.env.QA_SCRIBE_LIVE_APP_VERSION
      assert.match(evidence.appVersion ?? '', /^\d+\.\d+\.\d+$/, 'Helper must supply metadata from its fresh workspace build')
      await click('New Session')
      const title = `Live authorization ${provider} ${scenario}`
      const field = await $('[aria-label="Session title"]')
      await field.waitForDisplayed()
      await field.setValue(title)
      await browser.waitUntil(async () => (await read('list_sessions')).some((session) => session.title === title))
      const sessionId = (await read('list_sessions')).find((session) => session.title === title).id
      await click('Ask AI')
      await click('Configure AI')
      evidence.stage = 'settings'
      evidence.checkpoint = 'settings-availability'
      const select = await $('[aria-label="Default AI provider"]')
      evidence.setup.providerControlEnabled = await select.isEnabled()
      await select.waitForEnabled({ timeout: 30_000 })
      evidence.setup.providerControlEnabled = true
      await browser.waitUntil(async () => {
        evidence.setup.providerOptionAvailable = await browser.execute((id) => {
          const option = document.querySelector(`[aria-label="Default AI provider"] option[value="${id}"]`)
          return Boolean(option && !option.disabled)
        }, providerId)
        return evidence.setup.providerOptionAvailable
      }, { timeout: 30_000, timeoutMsg: 'Requested authenticated provider must appear in native Settings.' })
      evidence.checkpoint = 'settings-select'
      await select.selectByAttribute('value', providerId)
      // Commit through the native form control and ordinary React input/change
      // events, not controller state or a native settings mutation command.
      await browser.execute((id) => {
        const control = document.querySelector('[aria-label="Default AI provider"]')
        if (!(control instanceof HTMLSelectElement)) throw new Error('Provider select is unavailable')
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        setter.call(control, id)
        control.dispatchEvent(new Event('input', { bubbles: true }))
        control.dispatchEvent(new Event('change', { bubbles: true }))
      }, providerId)
      evidence.setup.selectionCommitted = await select.getValue() === providerId
      assert.equal(evidence.setup.selectionCommitted, true)
      evidence.checkpoint = 'settings-save-availability'
      const save = await $('button=Save settings')
      evidence.setup.saveRequired = (await read('get_settings')).selectedAiProvider !== providerId
      evidence.setup.saveButtonEnabled = await save.isEnabled()
      if (evidence.setup.saveRequired) await save.waitForEnabled({ timeout: 10_000 })
      evidence.setup.saveButtonEnabled = await save.isEnabled()
      evidence.checkpoint = 'settings-save'
      evidence.setup.saveClicked = false
      if (evidence.setup.saveButtonEnabled) { await save.click(); evidence.setup.saveClicked = true }
      evidence.checkpoint = 'settings-canonical-provider'
      await browser.waitUntil(async () => {
        const settings = await read('get_settings')
        evidence.setup.canonicalProviderMatches = settings.selectedAiProvider === providerId
        return evidence.setup.canonicalProviderMatches
      }, { timeout: 10_000, timeoutMsg: 'Native Settings must persist the requested provider.' })
      const settings = await read('get_settings')
      assert.equal(settings.selectedAiProvider, providerId, 'Canonical provider must persist before leaving Settings')
      evidence.checkpoint = 'settings-canonical-default'
      evidence.setup.canonicalModelNull = settings.selectedAiModel === null
      evidence.setup.canonicalProviderModelNull = settings.selectedAiModelsByProvider?.[providerId] === null
      assert.equal(settings.selectedAiModel, null, 'Fresh disposable settings must retain the CLI model default')
      assert.equal(settings.selectedAiModelsByProvider?.[providerId], null)
      evidence.selectedModel = settings.selectedAiModel
      evidence.checkpoint = 'settings-refresh-availability'
      const refresh = await $('[aria-label="Refresh CLI configuration"]')
      evidence.setup.refreshButtonAvailable = await refresh.isExisting()
      await refresh.waitForClickable({ timeout: 30_000 })
      evidence.setup.refreshButtonAvailable = true
      evidence.checkpoint = 'settings-refresh'
      await refresh.click()
      evidence.setup.refreshClicked = true
      evidence.checkpoint = 'settings-readiness'
      async function observedProvider() {
        const status = (await read('get_provider_status')).providers.find((candidate) => candidate.id === providerId)
        evidence.providerState = ['ready', 'authRequired', 'installRequired', 'error'].includes(status?.status) ? status.status : null
        evidence.setup.providerAvailable = status?.available === true
        evidence.setup.providerReady = status?.status === 'ready'
        // Only version numbers are retained, never paths, reasons, or raw discovery output.
        const defaultVersion = status?.defaultSnapshot?.cliVersion?.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null
        const catalogVersion = status?.catalogSnapshot?.cliVersion?.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null
        evidence.setup.defaultVersionPresent = Boolean(defaultVersion)
        evidence.setup.catalogVersionPresent = Boolean(catalogVersion)
        return evidence.setup.providerAvailable && evidence.setup.providerReady
      }
      await browser.waitUntil(observedProvider, { timeout: 60_000, timeoutMsg: 'Refreshed native provider must be available and authenticated.' })
      evidence.authenticated = true
      evidence.checkpoint = 'settings-cli-version'
      // Fast native snapshots may omit versions. R5 records the real resolved
      // wrapper binary's bounded --version result, independently of snapshots.
      evidence.cliVersion = process.env.QA_SCRIBE_LIVE_CLI_VERSION
      evidence.setup.cliVersionPresent = /^\d+\.\d+\.\d+$/.test(evidence.cliVersion ?? '')
      assert.equal(evidence.setup.cliVersionPresent, true, 'Helper must supply installed-cli-version-command metadata')
      assert.equal(evidence.setup.providerAvailable, true)
      assert.equal(evidence.setup.providerReady, true)
      evidence.checkpoint = 'settings-complete'
      await click('Back')
      await $('[aria-label="Session chat"] textarea').waitForDisplayed()
      assert.equal(calls().length, 0)
      await $('[aria-label="Session chat"] textarea').setValue(prompt)
      evidence.stage = 'send'
      await click('Send')
      await browser.waitUntil(async () => {
        const jobs = await read('list_active_ai_action_jobs')
        const job = jobs.find((candidate) => candidate.sessionId === sessionId && candidate.action === 'chat')
        if (job) jobId = job.jobId
        return Boolean(jobId)
      }, { timeout: 15_000, timeoutMsg: 'UI Send must create a native JobStore Chat job.' })
      evidence.nativeJob = true
      evidence.stage = 'pending'
      await $(panel).waitForDisplayed({ timeout: 90_000 })
      const pending = (await read('get_ai_action_job_status', { jobId })).pendingPermission
      if (!expectedTool(pending)) {
        // No blanket approvals or ToolSearch permissions. Safe discovery can
        // occur without a request; a requested discovery permission fails closed.
        await click('Cancel response')
        assert.fail('Unexpected tool identity: cancelled without approval.')
      }
      assert.ok(pending.requestId)
      const displayed = await $(panel).getText()
      assert.ok(displayed.includes('read_marker'))
      assert.ok(displayed.includes('This approval applies to this tool call only.'))
      assert.equal(calls().length, 0, 'Pending permission must precede actual marker execution')
      evidence.pendingPanel = true
      evidence.stage = 'decision'
      if (scenario === 'cancel') await click('Cancel response')
      else await click(scenario === 'approve' ? 'Approve once' : 'Deny')
      evidence.decision = scenario
      evidence.stage = 'terminal'
      let terminal
      let originalRequestResolved = false
      await browser.waitUntil(async () => {
        const job = await read('get_ai_action_job_status', { jobId })
        if (!job.pendingPermission) originalRequestResolved = true
        if (job.pendingPermission && (originalRequestResolved || job.pendingPermission.requestId !== pending.requestId)) {
          // Any repeat or other request after the sole decision is prohibited.
          if (await $('button=Cancel response').isExisting()) await click('Cancel response')
          assert.fail('Provider requested another permission after the controlled decision.')
        }
        if (['completed', 'failed', 'cancelled'].includes(job.state)) terminal = job
        return Boolean(terminal)
      }, { timeout: 120_000, timeoutMsg: 'Native provider turn must settle after the UI decision.' })
      assert.equal(terminal.state, scenario === 'cancel' ? 'cancelled' : 'completed')
      evidence.terminalState = terminal.state
      evidence.stage = 'durable'
      await $(panel).waitForDisplayed({ reverse: true })
      let durable
      await browser.waitUntil(async () => {
        durable = await read('get_chat', { sessionId })
        return scenario === 'cancel'
          ? durable.messages.length === 1 && durable.messages[0].status === 'cancelled'
          : durable.messages.length === 2 && durable.messages.every((message) => message.status === 'completed')
      }, { timeout: 15_000, timeoutMsg: 'Native final outcome must reach durable Chat storage.' })
      const nonce = readFileSync(process.env.QA_SCRIBE_LIVE_MARKER, 'utf8').trim()
      assert.ok(!prompt.includes(nonce))
      const final = durable.messages.find((message) => message.role === 'assistant')?.text ?? ''
      if (scenario !== 'cancel') assert.ok(final.trim(), 'Actual provider must persist nonempty final text')
      if (scenario === 'deny') assert.match(final, /DENIED/i, 'Actual provider must acknowledge the denial without retrying')
      if (final) evidence.finalTextSha256 = createHash('sha256').update(final).digest('hex')
      evidence.nonceInFinal = final.includes(nonce)
      evidence.markerCalls = calls().length
      assert.equal(evidence.markerCalls, scenario === 'approve' ? 1 : 0)
      assert.equal(evidence.nonceInFinal, scenario === 'approve')
      if (scenario !== 'cancel') {
        assert.ok(terminal.aiRunId, 'Completed turn must link the native AI Run')
        assert.equal(durable.messages[1].aiRunId, terminal.aiRunId)
        assert.ok((await $('[aria-label="Conversation transcript"]').getText()).includes(final))
      }
      const before = durable.messages
      evidence.stage = 'reload'
      // Recreate WebView state, reopen via actual Session Library, then compare
      // canonical native data and rendered transcript without invoking a model.
      await browser.refresh()
      const option = await $(`[role="option"]*=${title}`)
      await option.waitForClickable()
      await option.click()
      const chatButton = await $('button=Ask AI')
      await chatButton.waitForClickable()
      await chatButton.click()
      await $('[aria-label="Conversation transcript"]').waitForDisplayed()
      assert.deepEqual((await read('get_chat', { sessionId })).messages, before)
      await browser.waitUntil(async () => {
        const text = await $('[aria-label="Conversation transcript"]').getText()
        return scenario === 'cancel' ? text.includes('Cancelled') : text.includes(final)
      })
      assert.equal(calls().length, evidence.markerCalls, 'Reopen must not execute the marker again')
      evidence.persistence = true
      evidence.stage = 'complete'
      evidence.status = 'passed'
    } finally {
      // Always stop an outstanding provider using the UI, including assertion failures.
      try { if (await $('button=Cancel response').isExisting()) await click('Cancel response') } catch { /* Helper also kills process groups. */ }
      writeFileSync(process.env.QA_SCRIBE_LIVE_RESULT, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
    }
  })
})
