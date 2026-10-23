import { openCreationAi } from './creation-helpers.mjs'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { actionProof, confirmationCalls, handoffActions, installConfirmationProbe, noteAudit, noteMatrix, restartProof, reviewMatrix, startVideo } from './chat-handoff-proof.mjs'

const noteSelector = '[aria-label="Note body"][contenteditable="true"]'
const composerSelector = '[aria-label="Session chat"] textarea'
const originalNote = 'Existing rich Note: checkout setup and retained evidence.'
const user1 = ('**Literal user context** <keep-literal> I tested checkout on build 2026.10.14 in staging using Linux and Firefox. '
  + 'The confirmation screen stayed empty after a successful payment response. '
  + 'I repeated the flow with a fresh account and retained the request identifier: '
  + 'checkout-request-'.repeat(18)).padEnd(4 * 1024, 'x')
const user2 = 'I expected a receipt and order number. Instead the confirmation was blank, although HTTP 200 was returned.'
const assistant1 = 'Which build and environment did you test?'
const markdownFixture = process.env.QA_SCRIBE_E2E_CHAT_MARKDOWN === '1'
const assistant3 = 'What did you expect, and what happened instead?' + (markdownFixture
  ? ' Retained evidence: checkout-request. ' + 'Review the request, payment response, and confirmation screen together. '.repeat(70).trimEnd() : '')
const assistant3Source = markdownFixture
  ? 'What did you expect, and what happened instead? **Retained evidence**: `checkout-request`. '
    + 'Review the request, payment response, and confirmation screen together. '.repeat(70).trimEnd() : assistant3
const edit = ' Tester reviewed the submitted conversation and confirmed the reproduction.'

async function click(label) {
  const target = await $(`button=${label}`)
  await target.waitForClickable()
  await target.click()
}

async function publicRead(command, args = {}) {
  return browser.execute(async (name, parameters) =>
    window.__TAURI_INTERNALS__.invoke(name, parameters), command, args)
}

async function savedNote() {
  await browser.waitUntil(async () => browser.execute(() =>
    document.querySelector('p.status-pill.saved')?.textContent?.includes('Note saved') ?? false),
  { timeout: 5_000, timeoutMsg: 'Chat workflow Note did not autosave' })
}

async function canonicalNote(sessionId) {
  const notes = (await publicRead('list_entries', { sessionId })).filter((entry) => entry.entryType === 'note')
  assert.equal(notes.length, 1, 'Chat handoff must retain one primary Note Entry')
  return notes[0]
}

async function chat(sessionId) {
  return publicRead('get_chat', { sessionId })
}

async function settledChat(sessionId, composer) {
  await browser.waitUntil(async () => {
    const current = await chat(sessionId)
    return current.composer === composer && await browser.execute(() =>
      document.querySelector('[aria-label="Session chat"] [role="status"]')?.textContent === 'Conversation saved')
  }, { timeout: 5_000, timeoutMsg: 'Chat composer did not become durable' })
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
    { timeout: 5_000, timeoutMsg: 'Unique Chat workflow Session title did not persist' })
  const sessions = await publicRead('list_sessions')
  return sessions.find((session) => session.title === title).id
}

// Native DOM selection and WebView editing only, never a TipTap command or app state mutation.
async function insertNote(text, selectAll = false) {
  await $(noteSelector).waitForDisplayed()
  assert.ok(await browser.execute((selector, value, replace) => {
    const editor = document.querySelector(selector)
    editor.focus()
    const range = document.createRange()
    const paragraph = Array.from(editor.querySelectorAll('p')).filter((node) => node.textContent.trim()).at(-1)
    range.selectNodeContents(replace ? editor : paragraph)
    if (!replace) range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return document.execCommand('insertText', false, value)
  }, noteSelector, text, selectAll), 'Native WebView editing must insert Note text')
}

async function assertTranscript(expected) {
  const actual = await browser.execute(() => Array.from(document.querySelectorAll('.chat-messages > li'), (row) => ({
    role: row.querySelector('header strong')?.textContent,
    text: row.querySelector('.chat-message-text')?.textContent,
    status: row.querySelector('.chat-turn-status')?.textContent ?? 'Completed',
  })))
  assert.deepEqual(actual, expected)
}

function transcriptRows(secondStatus = null) {
  const rows = [
    { role: 'You', text: user1, status: 'Completed' },
    { role: 'Assistant', text: assistant1, status: 'Completed' },
  ]
  if (secondStatus) rows.push({ role: 'You', text: user2, status: secondStatus })
  if (secondStatus === 'Completed') rows.push({ role: 'Assistant', text: assistant3, status: 'Completed' })
  return rows
}

function invocationCount(directory) {
  return readdirSync(directory).filter((name) => /^codex-exec-\d+\.started$/.test(name)).length
}

async function fixtureFile(directory, name) {
  const path = join(directory, name)
  await browser.waitUntil(() => existsSync(path), { timeout: 10_000, timeoutMsg: `Missing Chat fixture ${name}` })
  return path
}

async function release(directory, index) {
  await fixtureFile(directory, `codex-exec-${index}.started`)
  writeFileSync(join(directory, `codex-exec-${index}.release`), 'released by Chat workflow\n', { flag: 'wx' })
}

async function completed(sessionId, count) {
  await browser.waitUntil(async () => {
    const current = await chat(sessionId)
    return current.messages.length === count && current.messages.every((message) => message.status === 'completed')
      && await browser.execute((expected) => document.querySelectorAll('.chat-messages > li').length === expected, count)
  }, { timeout: 15_000, timeoutMsg: 'Chat response did not reach the durable completed transcript' })
}

function assertRichNote(note, originalNodes, submitted = true, edited = false) {
  assert.equal(note.bodyFormat, 'tiptap_json')
  const nodes = JSON.parse(note.bodyJson).doc.content
  assert.deepEqual(nodes.slice(0, originalNodes.length), originalNodes, 'Original rich Note nodes must be preserved verbatim')
  assert.match(note.body, /<strong>/)
  assert.match(note.body, /<ul>/)
  if (submitted) {
    const messages = [user1, assistant1, user2, assistant3]

    assert.equal(note.body.split('User:').length - 1, 2)
    assert.equal(note.body.split('Assistant:').length - 1, 2)
    const appended = nodes.slice(originalNodes.length)
    const content = appended.map((node) => (node.content ?? []).map((child) => child.type === 'hardBreak' ? '\n' : child.text ?? '').join(''))
    for (const text of messages) assert.equal(content.join('\n').split(text).length - 1, 1, 'Each saved message must appear exactly once in canonical rich content')
    assert.deepEqual(content.slice(0, 4), messages.map((text, index) => `${index % 2 ? 'Assistant:' : 'User:'}\n${text}${edited && index === 3 ? edit : ''}`))
  }
}

async function capture(artifacts, filename, selector) {
  await $(selector).scrollIntoView()
  const geometry = await browser.execute((targetSelector) => {
    const target = document.querySelector(targetSelector)
    const rect = target.getBoundingClientRect()
    const texts = Array.from(document.querySelectorAll('.chat-message-text'), (element) => {
      const box = element.getBoundingClientRect()
      return { width: box.width, client: element.clientWidth, scroll: element.scrollWidth }
    })
    return { width: innerWidth, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      height: innerHeight, documentWidth: document.documentElement.scrollWidth, texts }
  }, selector)
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1, 'Workflow control must fit horizontally')
  assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height + 1, 'Workflow control must be reachable in the viewport')
  assert.ok(geometry.documentWidth <= geometry.width + 1, 'Long Chat content must not overflow the WebView')
  for (const text of geometry.texts) assert.ok(text.width > 0 && text.scroll <= text.client + 1, 'Long transcript text must wrap')
  await browser.saveScreenshot(join(artifacts, filename))
  writeFileSync(join(artifacts, filename.replace('.png', '.geometry.json')), JSON.stringify(geometry, null, 2))
}

export async function runChatToNoteWorkflow() {
  const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
  const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS ?? join(process.cwd(), 'artifacts', 'e2e')
  assert.equal(Buffer.byteLength(user1), 4 * 1024, 'Saved literal user fixture remains long and within the generation prompt budget')
  assert.ok(directory, 'Chat workflow requires the isolated provider fixture directory')
  assert.equal(invocationCount(directory), 0, 'Session lifecycle must not invoke AI before Chat workflow')
  const suffix = Date.now()
  const primaryTitle = `E2E Chat primary ${suffix}`
  const secondaryTitle = `E2E Chat isolation ${suffix}`
  const primaryId = await create(primaryTitle)
  await click('Write note')
  await insertNote(originalNote, true)
  // Select actual editor text, then use its real formatting toolbar.
  await browser.execute((selector) => {
    const paragraph = document.querySelector(`${selector} p`)
    paragraph.closest('[contenteditable]').focus()
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, noteSelector)
  await $('[role="toolbar"][aria-label="Formatting toolbar"] button[aria-label="Bold"]').click()
  await $('[role="toolbar"][aria-label="Formatting toolbar"] button[aria-label="Bulleted list"]').click()
  await browser.waitUntil(async () => browser.execute((selector, text) => {
    const editor = document.querySelector(selector)
    return editor.querySelector('ul li strong')?.textContent === text
  }, noteSelector, originalNote))
  await savedNote()
  await browser.waitUntil(async () => {
    const note = await canonicalNote(primaryId)
    return note.body.includes(originalNote) && note.body.includes('<strong>') && note.body.includes('<ul>')
  }, { timeout: 5_000, timeoutMsg: 'Toolbar-created rich Note did not reach storage' })
  const original = await canonicalNote(primaryId)
  const originalNodes = JSON.parse(original.bodyJson).doc.content
  assertRichNote(original, originalNodes, false)

  noteAudit('start')
  await click('Chat')
  await settledChat(primaryId, '')
  await assertTranscript([])
  assert.match(await $('[aria-label="Conversation transcript"]').getText(), /No messages yet/)
  assert.equal(await $('button=Send').isEnabled(), false)
  assert.equal(await $('button=Add conversation to note').isEnabled(), false)
  await $(composerSelector).setValue(user1)
  await click('Send')
  await fixtureFile(directory, 'codex-exec-1.started')
  await assertTranscript([{ role: 'You', text: user1, status: 'Running' }])
  await release(directory, 1)
  await completed(primaryId, 2)
  await assertTranscript(transcriptRows())

  const recording = startVideo()
  await $(composerSelector).setValue(user2)
  await settledChat(primaryId, user2)
  await capture(artifacts, 'chat-unsent.png', '.chat-handoff button')
  assert.equal(await $('button=Review saved conversation').isExisting(), true)
  assert.equal(await $('button=Add conversation to note').isEnabled(), false)
  const secondaryId = await create(secondaryTitle)
  await click('Chat')
  await settledChat(secondaryId, '')
  await assertTranscript([])
  assert.equal(await $(composerSelector).getValue(), '')
  assert.equal((await chat(secondaryId)).messages.length, 0)
  await reopen(primaryTitle)
  await settledChat(primaryId, user2)
  assert.equal(await $(composerSelector).getValue(), user2)
  await assertTranscript(transcriptRows())

  // A fresh WebView must recover messages and composer without billing another turn.
  await browser.refresh()
  await $('[aria-label="Session title"]').waitForDisplayed()
  await reopen(primaryTitle)
  await click('Chat')
  await settledChat(primaryId, user2)
  assert.equal(await $(composerSelector).getValue(), user2)
  await assertTranscript(transcriptRows())
  assert.equal(invocationCount(directory), 1)
  await click('Send')
  await fixtureFile(directory, 'codex-exec-2.started')
  await capture(artifacts, 'chat-pending.png', '.chat-handoff button')
  assert.equal(await $('button=Review saved conversation').isExisting(), false)
  await click('Cancel response')
  await $('button=Retry response').waitForClickable()
  assert.equal(existsSync(join(directory, 'codex-exec-2.release')), false)
  await assertTranscript(transcriptRows('Cancelled'))
  assert.equal(await $('button=Add conversation to note').isEnabled(), false)
  const cancelled = await chat(primaryId)
  assert.equal(cancelled.messages.length, 3)
  const cancelledUserId = cancelled.messages[2].id
  await click('Retry response')
  await fixtureFile(directory, 'codex-exec-3.started')
  const replay = JSON.parse(readFileSync(await fixtureFile(directory, 'codex-exec-3.chat.json'), 'utf8'))
  assert.deepEqual(replay.messages, [
    { role: 'user', text: user1 }, { role: 'assistant', text: assistant1 }, { role: 'user', text: user2 },
  ], 'Retry prompt must contain completed previous pair and exactly one current user message')
  assert.equal(replay.response, assistant3Source)
  assert.ok(Array.isArray(replay.argv) && replay.argv[0] === 'app-server', 'Chat uses native duplex transport')
  assert.ok(!replay.argv.includes('--dangerously-bypass-approvals-and-sandbox'), 'Chat retains CLI permission policy')
  await release(directory, 3)
  await completed(primaryId, 4)
  await assertTranscript(transcriptRows('Completed'))
  assert.equal((await chat(primaryId)).messages[2].id, cancelledUserId, 'Retry must reuse the cancelled user message')
  assert.equal(invocationCount(directory), 3)
  assert.deepEqual(await publicRead('list_drafts', { sessionId: primaryId }), [])
  const maximumUnsent = 'Unsent context '.padEnd(16 * 1024, 'x')
  await $(composerSelector).setValue(maximumUnsent)
  await settledChat(primaryId, maximumUnsent)
  assert.equal(await $('button=Add conversation to note').isEnabled(), false)
  assert.equal(await $('button=Review saved conversation').isEnabled(), true)
  await capture(artifacts, 'chat-unsent-maximum.png', '.chat-handoff button')
  await $(composerSelector).setValue('')
  await settledChat(primaryId, '')
  await installConfirmationProbe()
  const ready = await chat(primaryId)
  const reviewProviderCount = invocationCount(directory)
  assert.ok(ready.messages[3].aiRunId, 'Successful fixture assistant must have a durable run association')
  assert.equal(ready.messages[3].text, assistant3Source)
  assert.deepEqual(noteAudit('read'), [], 'Chat and review preparation must not write the Note')
  await capture(artifacts, 'chat-completed.png', '.chat-handoff button')
  await click('Review saved conversation')
  await actionProof('.chat-review > button', 'chat-review.png')
  const savedReview = await browser.execute(() => Array.from(document.querySelectorAll('[aria-label="Saved conversation"] .chat-messages > li'), row => ({
    role: row.querySelector('header strong').textContent, text: row.querySelector('.chat-message-text').textContent,
  })))
  assert.deepEqual(savedReview, transcriptRows('Completed').map(({ role, text }) => ({ role, text })))
  if (markdownFixture) assert.equal(await (await $('[aria-label="Saved conversation"]')).$('strong=Retained evidence').isExisting(), true)
  await click('Review saved conversation')
  await reviewMatrix()
  assert.deepEqual(noteAudit('read'), [], 'Optional review must not write the Note')
  assert.equal(invocationCount(directory), 3, 'Review must not start a provider')
  assert.deepEqual(await confirmationCalls(), [])

  const handoffProviderCount = invocationCount(directory)
  await click('Add conversation to note')
  await $(noteSelector).waitForDisplayed()
  await browser.waitUntil(async () => (await $(noteSelector).getText()).includes(assistant3))
  assert.deepEqual(await confirmationCalls(), [], 'One ordinary Add must not ask for confirmation')
  await $('[aria-label="Conversation added"]').waitForDisplayed()
  await actionProof('.chat-added button', 'chat-added.png')
  assert.equal(await $('button=Write note').getAttribute('aria-pressed'), 'true')
  const submitted = await chat(primaryId)
  assert.ok(submitted.submission)
  const handoff = await canonicalNote(primaryId)
  let hydration = null
  if (process.env.QA_SCRIBE_E2E_NOTE_HYDRATION_PROBE === '1') {
    hydration = await browser.execute((selector) => {
      const editor = document.querySelector(selector).editor
      const before = JSON.stringify(editor.getJSON())
      const updates = []
      const observe = ({ editor }) => updates.push({ documentJson: JSON.stringify(editor.getJSON()), stack: new Error().stack })
      editor.on('update', observe)
      editor.setEditable(editor.isEditable)
      editor.off('update', observe)
      const after = JSON.stringify(editor.getJSON())
      if (after !== before) throw new Error('Editability hydration must not change content')
      return { before, after, updates }
    }, noteSelector)
    assert.equal(hydration.updates.length, 1, 'Hydration probe must exercise the real editor update callback')
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector('.document-status[role="status"]')?.textContent === 'Autosaved'),
    { timeout: 5_000, timeoutMsg: 'Hydration must leave the Note saved without a content edit' })
  }
  assert.equal(handoff.id, original.id)
  assertRichNote(handoff, originalNodes)
  assert.equal(invocationCount(directory), 3, 'Submit must not invoke AI')
  assert.deepEqual(await publicRead('list_drafts', { sessionId: primaryId }), [])
  await capture(artifacts, 'chat-submitted-note.png', '.chat-added button')
  await click('Chat')
  await settledChat(primaryId, '')
  await assertTranscript(transcriptRows('Completed'))
  assert.equal(await $('button=Open updated Note').isEnabled(), true)
  assert.equal(await $('button=Review saved conversation').isEnabled(), true)
  assert.equal(await $(composerSelector).isEnabled(), false)
  const beforeReplay = await canonicalNote(primaryId)
  const updatesBeforeReplay = noteAudit('read')
  // Repeat only the public idempotent command after the UI completed the handoff.
  const receipt = await publicRead('submit_chat', { request: {
    scope: { sessionId: primaryId, draftId: submitted.draftId, expectedRevision: submitted.revision },
    noteId: handoff.id, expectedNoteBody: handoff.body,
    expectedNoteBodyJson: handoff.bodyJson, expectedNoteBodyFormat: handoff.bodyFormat,
  } })
  assert.deepEqual(receipt, submitted.submission)
  const replayed = await canonicalNote(primaryId)
  writeFileSync(join(artifacts, 'note-rewrite-proof.json'), JSON.stringify({ handoff, hydration, beforeReplay,
    updatesBeforeReplay, replayed, updates: noteAudit('read') }, null, 2))
  assert.deepEqual(replayed, handoff, 'Repeated public submission must not change the Note')
  assert.equal(invocationCount(directory), 3)

  await click('Open updated Note')
  await actionProof('.chat-added button', 'note-after-chat.png')
  const appendUpdates = noteAudit('read')
  assert.equal(appendUpdates.length, 1, 'Ordinary Add and receipt replay must update the Note exactly once')
  writeFileSync(join(artifacts, 'note-append-audit.json'), JSON.stringify(appendUpdates, null, 2))
  await insertNote(edit)
  await savedNote()
  await browser.waitUntil(async () => (await canonicalNote(primaryId)).body.includes(edit.trim()),
    { timeout: 5_000, timeoutMsg: 'Submitted Note edit did not reach storage' })
  await reopen(secondaryTitle)
  await reopen(primaryTitle)
  await click('Write note')
  await $(noteSelector).waitForDisplayed()
  assert.ok((await $(noteSelector).getText()).includes(edit.trim()))
  const edited = await canonicalNote(primaryId)
  assertRichNote(edited, originalNodes, true, true)

  await openCreationAi('testware')
  await $('dialog').waitForDisplayed()
  const confirm = await (await $('dialog')).$('button=Generate')
  await confirm.waitForClickable()
  await confirm.click()
  await fixtureFile(directory, 'codex-exec-4.started')
  const generationPrompt = readFileSync(await fixtureFile(directory, 'codex-exec-4.prompt.txt'), 'utf8')
  for (const text of [originalNote, 'User:', 'Assistant:', user1, assistant1, user2, assistant3, edit.trim()]) {
    assert.ok(generationPrompt.includes(text), `Explicit Testware prompt must include saved Note content: ${text}`)
  }
  await release(directory, 4)
  await browser.waitUntil(async () => {
    const body = await $('body').getText()
    return body.includes('E2E test cases') && body.includes('Deterministic generated case') && body.includes('Testware generated')
  }, { timeout: 15_000, timeoutMsg: 'Explicit Chat-source Testware generation did not complete' })
  const drafts = await publicRead('list_drafts', { sessionId: primaryId })
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].kind, 'testware')
  assert.ok(drafts[0].aiRunId)
  assert.match(drafts[0].body, /Deterministic generated case/)
  await $('[role="tab"]*=Note').click()
  await reopen(secondaryTitle)
  await reopen(primaryTitle)
  await $('[role="tab"]*=Test cases').click()
  await $('h2=E2E test cases').waitForDisplayed()
  assert.deepEqual(await publicRead('list_drafts', { sessionId: primaryId }), drafts)
  assert.equal(invocationCount(directory), 4, 'Only explicit generation may start invocation four')
  await $('[role="tab"]*=Note').click()
  await click('Write note')
  await noteMatrix()
  writeFileSync(join(artifacts, 'handoff-protocol.json'), JSON.stringify({ sessionId: primaryId, original, submitted, handoff, replayedReceipt: receipt, edited }, null, 2))
  await restartProof(primaryId, publicRead, { note: edited, receipt: submitted.submission })
  assert.equal(invocationCount(directory), 4)
  const actions = await handoffActions()
  assert.equal(actions.filter(label => label === 'Add conversation to note').length, 1)
  writeFileSync(join(artifacts, 'handoff-counts.json'), JSON.stringify({ normalAddActivations: actions.filter(label => label === 'Add conversation to note').length, addConfirmations: 0,
    reviewProviderStarts: handoffProviderCount - reviewProviderCount, handoffProviderStarts: 3 - handoffProviderCount, chatAttempts: 3, explicitGenerationAttempt: invocationCount(directory), actions,
    appendUpdates: appendUpdates.length, receiptReplayEqual: true, restartConfirmations: 2,
    nativeFaultLanes: { 8: 'unavailable: no established lost-ack seam', 9: 'unavailable: no established canonical-read failure seam' } }, null, 2))
  if (recording) await recording.done
}
