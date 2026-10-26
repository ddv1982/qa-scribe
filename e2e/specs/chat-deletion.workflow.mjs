import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const noteSelector = '[aria-label="Note body"][contenteditable="true"]'

async function publicRead(command, args = {}) {
  return browser.execute(async (name, parameters) =>
    window.__TAURI_INTERNALS__.invoke(name, parameters), command, args)
}

async function click(label) {
  if (label === 'Ask AI' && await $('.ask-ai-panel--notes').isDisplayed()) return
  const target = await $(label === 'Close Ask AI'
    ? '.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]' : `button=${label}`)
  await target.waitForClickable()
  await target.click()
}

async function reopen(title) {
  const option = await $(`[role="option"]*=${title}`)
  await option.waitForClickable()
  await option.click()
  await browser.waitUntil(async () => (await $('[aria-label="Session title"]')).getValue().then((value) => value === title))
}

async function create(title) {
  const noteTab = await $('[role="tab"]*=Note')
  if (await noteTab.isExisting()) await noteTab.click()
  await click('New Session')
  const field = await $('[aria-label="Session title"]')
  await field.waitForDisplayed()
  await field.setValue(title)
  await browser.waitUntil(async () => (await publicRead('list_sessions')).some((session) => session.title === title),
    { timeout: 5_000, timeoutMsg: 'Deletion workflow Session title did not persist' })
  return (await publicRead('list_sessions')).find((session) => session.title === title).id
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

// Cleanup is never used as evidence: call only after the regression has failed.
function cleanupFixture(pid) {
  try {
    if (!processExists(pid)) return
    try {
      process.kill(-pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
      process.kill(pid, 'SIGKILL')
    }
  } catch (error) {
    if (error.code !== 'ESRCH') console.error('Deletion regression fixture cleanup failed:', error)
  }
}

export async function runChatDeletionWorkflow() {
  const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
  const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS ?? join(process.cwd(), 'artifacts', 'e2e')
  assert.ok(directory, 'Deletion workflow requires the isolated provider fixture directory')
  const files = readdirSync(directory)
  assert.equal(files.filter((name) => /^codex-exec-\d+\.started$/.test(name)).length, 4,
    'Deletion regression must follow the existing four-invocation Chat workflow')
  // Match the real fixture reservation scheme, rather than assuming slot five.
  let index = 1
  while (existsSync(join(directory, `codex-exec-${index}.lock`))) index += 1
  const startedPath = join(directory, `codex-exec-${index}.started`)
  const releasePath = join(directory, `codex-exec-${index}.release`)
  const surviving = (await publicRead('list_sessions')).find((session) => session.title === 'E2E primary session')
  assert.ok(surviving, 'The original Session-lifecycle Session must survive')
  const suffix = Date.now()
  const title = `E2E Chat deletion ${suffix}`
  const message = `Cancel this running Chat by deleting its Session ${suffix}.`
  const observations = { title, invocation: index, survivingSessionId: surviving.id }
  let pid = null
  let passed = false
  try {
    const sessionId = await create(title)
    observations.sessionId = sessionId
    await click('Ask AI')
    await $('[aria-label="Session chat"] textarea').setValue(message)
    // Send is the real UI preflight and provider-readiness boundary.
    await click('Send')
    await browser.waitUntil(() => existsSync(startedPath),
      { timeout: 10_000, timeoutMsg: `Deletion Chat fixture did not create invocation ${index}` })
    pid = Number(readFileSync(startedPath, 'utf8').trim())
    assert.ok(Number.isSafeInteger(pid) && pid > 1, 'Fixture must record a real provider PID')
    observations.pid = pid
    assert.equal(processExists(pid), true, 'Provider must be alive before deletion')
    assert.equal(existsSync(releasePath), false, 'Provider must still be blocked before deletion')
    const replay = JSON.parse(readFileSync(join(directory, `codex-exec-${index}.chat.json`), 'utf8'))
    assert.deepEqual(replay.messages, [{ role: 'user', text: message }])

    let active = []
    await browser.waitUntil(async () => {
      active = (await publicRead('list_active_ai_action_jobs'))
        .filter((job) => job.sessionId === sessionId && job.action === 'chat')
      return active.length === 1
    }, { timeout: 5_000, timeoutMsg: 'Exact Session-owned Chat job was not active before deletion' })
    const job = active[0]
    observations.beforeDeletion = job
    assert.ok(['starting', 'running'].includes(job.state), 'Chat must not already be cancelling')

    await $('[aria-label="Delete Session"]').click()
    const confirm = await $('button=Delete Session permanently')
    await confirm.waitForClickable()
    const deletionStarted = performance.now()
    await confirm.click()
    const remaining = 5_000 - (performance.now() - deletionStarted)
    assert.ok(remaining > 0, 'Session deletion confirmation exceeded the five-second PID-exit budget')
    await browser.waitUntil(() => !processExists(pid), {
      timeout: remaining,
      interval: 50,
      timeoutMsg: `Session deletion left Chat provider PID ${pid} alive after five seconds (review comment4267934724)`,
    })
    observations.pidExitMs = performance.now() - deletionStarted
    assert.ok(observations.pidExitMs <= 5_000, 'Provider PID must exit within five seconds of deletion confirmation')
    assert.equal(existsSync(releasePath), false, 'PID exit must not depend on releasing the fixture')

    let status
    await browser.waitUntil(async () => {
      status = await publicRead('get_ai_action_job_status', { jobId: job.jobId })
      return status.state === 'cancelled'
    }, { timeout: 5_000, timeoutMsg: 'Deleted Session Chat job did not become Cancelled' })
    observations.afterDeletion = status
    assert.equal(status.sessionId, sessionId)
    assert.equal(status.action, 'chat')
    assert.equal((await publicRead('list_active_ai_action_jobs')).some((current) => current.jobId === job.jobId), false,
      'Cancelled Chat must no longer be an active backend job')
    await browser.waitUntil(async () => !(await publicRead('list_sessions')).some((session) => session.id === sessionId),
      { timeout: 5_000, timeoutMsg: 'Deleted Session remained in native storage' })
    await $(`[role="option"]*=${title}`).waitForExist({ reverse: true })

    await reopen(surviving.title)
    if (await $('.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]').isDisplayed()) await click('Close Ask AI')
    await $(noteSelector).waitForDisplayed()
    assert.match(await $(noteSelector).getText(), /Primary note persisted/)
    const freshTitle = `E2E after Chat deletion ${suffix}`
    const freshId = await create(freshTitle)
    if (await $('.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]').isDisplayed()) await click('Close Ask AI')
    const text = `Note writes still persist after Session-owned Chat cancellation ${suffix}.`
    await $(noteSelector).setValue(text)
    await browser.waitUntil(async () => (await publicRead('list_entries', { sessionId: freshId }))
      .some((entry) => entry.entryType === 'note' && entry.body.includes(text)),
    { timeout: 5_000, timeoutMsg: 'New Session Note did not persist after deleting running Chat' })
    await reopen(surviving.title)
    await reopen(freshTitle)
    if (await $('.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]').isDisplayed()) await click('Close Ask AI')
    await browser.waitUntil(async () => (await $(noteSelector).getText()).includes(text),
      { timeout: 5_000, timeoutMsg: 'New Session Note did not reopen after Chat deletion' })
    assert.equal(existsSync(releasePath), false)
    observations.newSessionId = freshId
    passed = true
  } catch (error) {
    observations.failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    // Retain the original assertion even if artifact capture or cleanup fails.
    if (!passed) {
      try {
        if (pid === null && existsSync(startedPath)) {
          const recorded = Number(readFileSync(startedPath, 'utf8').trim())
          if (Number.isSafeInteger(recorded) && recorded > 1) pid = recorded
        }
        if (pid !== null) cleanupFixture(pid)
      } catch (error) {
        console.error('Deletion regression fixture PID recovery failed:', error)
      }
    }
    try {
      writeFileSync(join(artifacts, 'chat-deletion.observations.json'), `${JSON.stringify(observations, null, 2)}\n`)
      await browser.saveScreenshot(join(artifacts, passed ? 'chat-deletion-persisted-note.png' : 'chat-deletion-failed.png'))
    } catch (error) {
      console.error('Deletion regression artifact capture failed:', error)
    }
  }
}
