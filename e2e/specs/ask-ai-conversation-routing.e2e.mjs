import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { click, create, fill, fixture, native, out, save, tab } from './composer-proof.mjs'
import { imageFixture } from '../fixtures/chat-images-provider.mjs'

const env = process.env
const phase = env.QA_SCRIBE_E2E_ROUTING_PHASE
assert.ok(['initial', 'restart'].includes(phase))
const sourceManifest = env.QA_SCRIBE_I2_SOURCE_MANIFEST
assert.ok(sourceManifest && existsSync(sourceManifest), 'Record the dirty source manifest before building')
const receipt = { schema: 'qa-scribe-i2-routing-v1', phase, base: '96be7f218800f9a00aa2f1ee2ccbb3f75dd78b52', candidateCommit: null,
  sourceManifestSha256: createHash('sha256').update(readFileSync(sourceManifest)).digest('hex'),
  binarySha256: createHash('sha256').update(readFileSync(env.QA_SCRIBE_E2E_BINARY)).digest('hex'),
  inputMechanism: 'Maintained embedded driver programmatic native WebView clicks and DOM input. No OS-key claim.',
  scope: 'Released Notes interaction and separately labelled hidden Tauri boundaries. No I3 launch, Continue, or History controls.', cases: [], completed: false }
const persist = () => writeFileSync(join(out, 'conversation-routing.json'), `${JSON.stringify(receipt, null, 2)}\n`)
const composer = '.ask-ai-panel textarea'
const title = 'I2 deterministic routing Session'
const exact = reference => native('get_conversation', { reference })
const reference = chat => ({ sessionId: chat.sessionId, draftId: chat.draftId })
const scope = chat => ({ ...reference(chat), expectedRevision: chat.revision })
const executions = () => readdirSync(fixture).filter(name => /^codex-exec-\d+\.started$/.test(name)).length
const notes = () => native('get_chat', { sessionId: session.id })
let session
let sourceA
let sourceB
let A
let B
let C

async function proof(lane, facts, kind = 'released-notes-plus-hidden-tauri-boundary') {
  const directory = join(dirname(out), `lane-${lane}`)
  mkdirSync(directory, { recursive: true })
  await browser.saveScreenshot(join(directory, 'result.png'))
  const ui = await browser.execute(() => ({ text: document.body.innerText.slice(-10000), composer: document.querySelector('.ask-ai-panel textarea')?.value }))
  receipt.cases.push({ lane, kind, facts, ui }); persist()
  writeFileSync(join(directory, 'assertions.json'), `${JSON.stringify(receipt.cases.at(-1), null, 2)}\n`)
}
function storedRows() {
  return JSON.parse(execFileSync('python3', ['-c', `import sqlite3,json,sys
with sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True) as db:
 db.row_factory=sqlite3.Row
 print(json.dumps({t:[dict(r) for r in db.execute('SELECT * FROM '+t)] for t in ['chat_drafts','chat_messages','chat_composer_images','chat_message_images','chat_refinements','chat_editor_stages','findings','ai_runs']}))`, join(env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite')], { encoding: 'utf8', timeout: 5000 }))
}
async function ownerChat(record) {
  return native('begin_record_chat', { request: { sessionId: session.id, draftId: randomUUID(), record: { kind: 'finding', recordId: record.id } } })
}
function context(record) {
  return { kind: 'finding', snapshot: { sessionId: record.sessionId, recordId: record.id, title: record.title,
    documentJson: record.bodyJson ?? JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: record.body }] }] } }),
    metadataJson: record.metadataJson, recordKind: record.kind, origin: 'saved', localFingerprint: '', storedBaseToken: '' } }
}
async function saveInput(chat, text, intent = 'message') {
  return native('save_chat_composer', { request: { scope: scope(chat), composer: text, intent: { kind: intent }, mode: 'chat', attachmentIds: chat.composerImages.map(image => image.attachmentId) } })
}
async function hiddenStart(chat, record, text, intent = 'message') {
  const saved = await saveInput(await exact(reference(chat)), text, intent)
  const index = executions() + 1
  const result = await browser.execute(request => {
    const internals = window.__TAURI_INTERNALS__
    const callback = internals.transformCallback(raw => {
      if ('end' in raw) { internals.unregisterCallback(callback); return }
      window.__i2RoutingEvents ??= []; window.__i2RoutingEvents.push(raw.message)
    })
    return internals.invoke('start_chat_job', { request, events: `__CHANNEL__:${callback}` })
  }, { scope: scope(saved), intent: { kind: 'composer' }, context: context(record), provider: 'codex_cli', model: 'default', reasoningEffort: null })
  assert.deepEqual(result.status.chat.reference, reference(chat))
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
  return { index, result, reference: reference(chat) }
}
function release(index) { writeFileSync(join(fixture, `codex-exec-${index}.release`), 'Release local deterministic response\n', { flag: 'wx' }) }
async function complete(turn) {
  release(turn.index)
  await browser.waitUntil(async () => (await exact(turn.reference)).messages.at(-1)?.role === 'assistant')
  const chat = await exact(turn.reference)
  assert.ok(chat.messages.every(message => message.status === 'completed'))
  if (turn.reference.draftId === (await notes()).draftId) {
    await browser.waitUntil(async () => !(await $('button=Cancel response').isExisting()))
    await browser.waitUntil(() => browser.execute(expected => [...document.querySelectorAll('.chat-message-assistant')].at(-1)?.textContent.replace(/\s/g, '').includes(expected.replace(/\s/g, '')) === true, chat.messages.at(-1).text))
    await browser.waitUntil(() => browser.execute(() => document.querySelector('.chat-meta [role="status"]')?.textContent === 'Conversation saved'))
  }
  return chat
}
async function visibleStart(text, button = 'Send') {
  const index = executions() + 1
  if (text !== null) await fill(composer, text)
  await click(`button=${button}`)
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
  return { index, reference: reference(await notes()) }
}
async function showNotes() {
  await tab('Note')
  await click('button=Chat')
  await $(composer).waitForDisplayed()
}
async function upload(filename) {
  await browser.execute((bytes, filename) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], filename, { type: 'image/png' }))
    const input = document.querySelector('input[aria-label="Choose chat images"]')
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  }, [...readFileSync(imageFixture.path)], filename)
}
async function recordControl(label) {
  const button = await (await $('.record-detail-pane')).$(`button=${label}`)
  await button.waitForClickable(); await button.click()
}
async function proposalControl(label) {
  const panel = (await $$('.chat-proposal')).at(-1)
  const button = await panel.$(`button=${label}`)
  await button.scrollIntoView(); await button.waitForClickable(); await button.click()
}

if (phase === 'restart') {
  describe('I2 actual native process restart', () => {
    it('lane 6 interrupts the committed owner and requires explicit Retry', async () => {
      const saved = JSON.parse(readFileSync(join(env.QA_SCRIBE_E2E_APP_DATA_DIR, 'i2-restart.json'), 'utf8'))
      session = saved.session
      await click(`[role="option"]*=${title}`)
      await showNotes()
      const chat = await exact(saved.reference)
      assert.equal(chat.messages.at(-1).id, saved.user.id)
      assert.equal(chat.messages.at(-1).status, 'interrupted')
      assert.equal(executions(), saved.executions)
      assert.equal((await exact(saved.unrelated)).messages.at(-1).status, 'completed')
      await proof(6, { reference: saved.reference, user: chat.messages.at(-1), executions: executions(), database: storedRows() }, 'native-process-restart-and-explicit-notes-retry')
      const retry = await visibleStart(null, 'Retry response')
      const result = await complete(retry)
      assert.equal(result.messages.at(-2).id, saved.user.id)
      receipt.completed = true; persist()
    })
  })
} else {
  describe('I2 hidden routing and released Notes regression lanes', () => {
    before(async () => {
      await click('button=New Session')
      await fill('[aria-label="Session title"]', title)
      await fill('[aria-label="Note body"]', 'I2 literal canonical Note body remains local.')
      await browser.waitUntil(async () => (await native('list_sessions')).some(value => value.title === title))
      session = (await native('list_sessions')).find(value => value.title === title)
      await tab('Findings')
      for (const name of ['I2 source A', 'I2 source B']) {
        await create('finding'); await fill('[aria-label="Finding title"]', name)
        await fill('[aria-label="Creation draft body"]', `Literal stored evidence for ${name}`); await save('finding')
      }
      const records = await native('list_findings', { sessionId: session.id })
      sourceA = records.find(record => record.title === 'I2 source A'); sourceB = records.find(record => record.title === 'I2 source B')
      A = await ownerChat(sourceA); B = await ownerChat(sourceB); C = await ownerChat(sourceA)
      await showNotes()
    })
    it('lane 1 hidden completion preserves literal Notes input and image ownership', async () => {
      await fill(composer, 'NOTES_RETAINED_TEXT')
      await upload('notes-retained.png')
      await browser.waitUntil(async () => (await notes()).composerImages.length === 1 && (await notes()).composer === 'NOTES_RETAINED_TEXT')
      const before = await notes()
      const turn = await hiddenStart(A, sourceA, 'ROUTING_A_1')
      const chat = await complete(turn)
      assert.equal(chat.messages.at(-1).text, 'Routing reply for ROUTING_A_1')
      assert.deepEqual(await notes(), before)
      assert.equal(await $(composer).getValue(), before.composer)
      await proof(1, { hidden: chat, notesBefore: before, notesAfter: await notes(), jobId: turn.result.jobId })
    })
    it('lane 2 three same-Session jobs retain separate replies and images', async () => {
      const image = `data:image/png;base64,${readFileSync(imageFixture.path).toString('base64')}`
      for (const chat of [A, B]) await native('import_chat_image', { scope: scope(await exact(reference(chat))), filename: `${chat.draftId}.png`, dataUrl: image })
      const a = await hiddenStart(A, sourceA, 'ROUTING_A_2')
      const b = await hiddenStart(B, sourceB, 'ROUTING_B_2')
      const n = await visibleStart('ROUTING_NOTES_2')
      const active = await native('list_active_ai_action_jobs')
      assert.equal(active.length, 3)
      assert.equal(new Set(active.map(job => job.chat.reference.draftId)).size, 3)
      const chats = [await complete(a), await complete(b), await complete(n)]
      assert.deepEqual(chats.map(chat => chat.messages.at(-1).text), ['Routing reply for ROUTING_A_2', 'Routing reply for ROUTING_B_2', 'Routing reply for ROUTING_NOTES_2'])
      const ids = chats.map(chat => chat.messages.at(-2).images.map(image => image.attachmentId))
      assert.ok(ids.every(images => images.length === 1)); assert.equal(new Set(ids.flat()).size, 3)
      await proof(2, { references: chats.map(reference), imageIds: ids, jobs: active, transcripts: chats.map(chat => chat.messages) })
    })
    it('lane 3 visible Notes permission and hidden request retain their exact authorities', async () => {
      const n = await visibleStart('ROUTING_PERMISSION_NOTES')
      const a = await hiddenStart(A, sourceA, 'ROUTING_PERMISSION_A')
      release(n.index); release(a.index)
      await $('[aria-label="Tool permission"]').waitForDisplayed()
      const permissionDirectory = join(dirname(out), 'lane-3')
      mkdirSync(permissionDirectory, { recursive: true })
      await browser.saveScreenshot(join(permissionDirectory, 'permission-pending.png'))
      let hidden
      await browser.waitUntil(async () => { hidden = await native('get_ai_action_job_status', { jobId: a.result.jobId }); return Boolean(hidden.pendingPermission) })
      const token = hidden.pendingPermission
      await assert.rejects(native('decide_chat_permission', { request: { jobId: hidden.jobId, sessionId: session.id, requestId: token.requestId, provider: 'claude_code', decision: 'approve' } }))
      assert.deepEqual((await native('get_ai_action_job_status', { jobId: hidden.jobId })).pendingPermission, token)
      await click('button=Approve once')
      await browser.waitUntil(async () => (await notes()).messages.at(-1).role === 'assistant')
      await native('decide_chat_permission', { request: { jobId: hidden.jobId, sessionId: session.id, requestId: token.requestId, provider: token.provider, decision: 'deny' } })
      await browser.waitUntil(async () => (await exact(reference(A))).messages.at(-1).role === 'assistant')
      await proof(3, { hiddenRequest: hidden, notes: await notes(), forgedProviderRejected: true })
    })
    it('lane 4 cancels Notes without cancelling hidden B', async () => {
      const n = await visibleStart('ROUTING_CANCEL_NOTES')
      const b = await hiddenStart(B, sourceB, 'ROUTING_B_SURVIVES_CANCEL')
      await click('button=Cancel response')
      await browser.waitUntil(async () => (await notes()).messages.at(-1).status === 'cancelled')
      const result = await complete(b)
      assert.equal(result.messages.at(-1).text, 'Routing reply for ROUTING_B_SURVIVES_CANCEL')
      await proof(4, { cancelled: await notes(), surviving: result, notesInvocation: n.index })
    })
    it('lane 5 reload reconnects the exact job without another invocation', async () => {
      const n = await visibleStart(null, 'Retry response')
      const before = executions()
      await browser.refresh()
      await click(`[role="option"]*=${title}`)
      await showNotes()
      await $('button=Cancel response').waitForDisplayed()
      assert.equal(executions(), before)
      const result = await complete(n)
      assert.equal(executions(), before)
      await proof(5, { reference: n.reference, chat: result, executions: before })
    })
    it('lane 7 holds native Notes import while hidden B retains typed intent', async () => {
      await fill(composer, 'NOTES_IMAGE_IMPORT_TEXT')
      await browser.execute(() => {
        const bridge = window.webkit.messageHandlers.ipc
        const descriptor = Object.getOwnPropertyDescriptor(bridge, 'postMessage')
        const original = bridge.postMessage
        window.__i2Import = { descriptor, bridge, original, held: null }
        Object.defineProperty(bridge, 'postMessage', { configurable: true, writable: true, value(raw) {
          if (JSON.parse(raw).cmd === 'import_chat_image') { window.__i2Import.held = raw; return }
          return original.call(bridge, raw)
        } })
      })
      await upload('notes-held.png')
      await browser.waitUntil(() => browser.execute(() => Boolean(window.__i2Import.held)))
      const hidden = await saveInput(await exact(reference(B)), 'B_DURING_NOTES_IMPORT', 'draft_jira')
      await browser.execute(() => {
        const state = window.__i2Import
        if (state.descriptor) Object.defineProperty(state.bridge, 'postMessage', state.descriptor)
        else delete state.bridge.postMessage
        state.original.call(state.bridge, state.held)
        delete window.__i2Import
      })
      await browser.waitUntil(async () => (await notes()).composerImages.length === 1)
      assert.deepEqual(await exact(reference(B)), hidden)
      assert.equal(hidden.composerIntent.kind, 'draft_jira')
      assert.equal((await notes()).composer, 'NOTES_IMAGE_IMPORT_TEXT')
      await proof(7, { notes: await notes(), hidden, controllerSchedule: 'useAppController.chat.isolation.test.ts supplies the separate captured-controller proof' })
      await fill(composer, '')
      await click('[aria-label="Remove notes-held.png"]')
      await browser.waitUntil(async () => (await notes()).composerImages.length === 0 && (await notes()).composer === '')
    })
    it('lane 8 stages Notes and atomically refuses the hidden competitor', async () => {
      await tab('Findings')
      const selection = await (await $('.record-master-list')).$(`button*=${sourceA.title}`)
      await selection.waitForClickable(); await selection.click()
      await click('button=Ask AI')
      const turn = await visibleStart('Review the expected result', 'Refine record')
      await complete(turn)
      await proposalControl('Review refinement')
      const hidden = await hiddenStart(C, sourceA, 'Hidden competitor refinement', 'refine_record')
      const offered = await complete(hidden)
      await proposalControl('Apply to editor')
      await browser.waitUntil(async () => (await notes()).proposals.at(-1).state.kind === 'staged')
      const stagedProposal = (await notes()).proposals.at(-1)
      await browser.waitUntil(async () => await $('[aria-label="Finding title"]').getValue() === stagedProposal.after.title)
      await assert.rejects(native('resolve_refinement', { request: { scope: scope(offered), proposalId: offered.proposals.at(-1).id, action: 'stage' } }))
      assert.deepEqual(await exact(reference(C)), offered)
      await proof(8, { notes: await notes(), hiddenOffered: offered, database: storedRows() })
    })
    it('lane 9 ordinary guarded Save settles the original proposal while a hidden chat completes', async () => {
      const d = await ownerChat(sourceB)
      const turn = await hiddenStart(d, sourceB, 'ROUTING_D_DURING_SAVE')
      const staged = (await notes()).proposals.at(-1)
      await recordControl('Save')
      await browser.waitUntil(async () => (await notes()).proposals.at(-1).state.kind === 'saved')
      const hidden = await complete(turn)
      const stored = (await native('list_findings', { sessionId: session.id })).find(record => record.id === sourceA.id)
      assert.equal(stored.title, staged.after.title)
      assert.equal(stored.bodyJson, staged.after.documentJson)
      assert.equal((await notes()).proposals.at(-1).state.stage.id, staged.state.stage.id)
      sourceA = stored
      await proof(9, { stored, settled: (await notes()).proposals.at(-1), hidden, database: storedRows() })
    })
    it('lane 10 explicit Retry preserves a deleted source snapshot', async () => {
      const turn = await visibleStart('ROUTING_DELETED_SOURCE')
      await click('button=Cancel response')
      await browser.waitUntil(async () => (await notes()).messages.at(-1).status === 'cancelled')
      const failed = (await notes()).messages.at(-1)
      await click('[aria-label="Close AI chat"]')
      await click(`[aria-label="Delete ${sourceA.title}"]`)
      await click('dialog button=Delete finding permanently')
      await browser.waitUntil(async () => !(await native('list_findings', { sessionId: session.id })).some(record => record.id === sourceA.id))
      await showNotes()
      const retry = await visibleStart(null, 'Retry response')
      const payload = JSON.parse(readFileSync(join(fixture, `codex-exec-${retry.index}.chat.json`), 'utf8'))
      assert.deepEqual(payload.messages.at(-1).context, failed.context)
      const done = await complete(retry)
      assert.equal(done.messages.at(-2).id, failed.id)
      const competitor = await exact(reference(C))
      await assert.rejects(native('resolve_refinement', { request: { scope: scope(competitor), proposalId: competitor.proposals.at(-1).id, action: 'stage' } }))
      await assert.rejects(hiddenStart(C, sourceA, 'FRESH_MISSING_SOURCE'))
      assert.equal((await exact(reference(C))).composer, 'FRESH_MISSING_SOURCE')
      await proof(10, { freshCaptureRejected: true, failed, retry: done.messages.at(-2), cancelledInvocation: turn.index, freshApplyRejected: true })
    })
    it('leaves one real committed Notes turn for the separate native restart', async () => {
      const turn = await visibleStart('ROUTING_RESTART')
      const chat = await notes()
      assert.equal(chat.messages.at(-1).status, 'running')
      writeFileSync(join(env.QA_SCRIBE_E2E_APP_DATA_DIR, 'i2-restart.json'), JSON.stringify({ session, reference: reference(chat), user: chat.messages.at(-1), executions: executions(), unrelated: reference(A), invocation: turn.index }))
      receipt.completed = receipt.cases.length === 9; persist()
    })
  })
}
