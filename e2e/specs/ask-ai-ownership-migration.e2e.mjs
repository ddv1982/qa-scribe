import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ownershipFixture } from '../../scripts/prepare-ask-ai-ownership.mjs'
import { click, native, out } from './composer-proof.mjs'

const env = process.env
const phase = env.QA_SCRIBE_E2E_OWNERSHIP_PHASE
assert.ok(['initial', 'reopen-1', 'reopen-2'].includes(phase), 'Use the maintained runner for all three launches')
assert.equal(env.QA_SCRIBE_I1_NATIVE_LANE_RELEASED, '1', 'The parent must release the native lane')
assert.match(env.QA_SCRIBE_E2E_SOURCE_SHA ?? '', /^[a-f0-9]{40}$/, 'Declare the exact candidate commit')
const data = env.QA_SCRIBE_E2E_APP_DATA_DIR
const notesRef = { sessionId: 'perf-session', draftId: 'perf-chat' }
const mixedRef = { sessionId: 'isolation-mixed', draftId: 'isolation-mixed-chat' }
const record = { kind: 'finding', recordId: 'perf-finding' }
const receipt = { schema: 'qa-scribe-i1-native-v1', phase, sourceSha: env.QA_SCRIBE_E2E_SOURCE_SHA ?? null,
  binarySha256: createHash('sha256').update(readFileSync(env.QA_SCRIBE_E2E_BINARY)).digest('hex'),
  scope: 'Existing Notes and refinement UI plus hidden I1 Tauri boundaries. No record launch, Continue, or History UI is claimed.',
  cases: [], completed: false }
const persist = () => writeFileSync(join(out, 'ownership-migration.json'), `${JSON.stringify(receipt, null, 2)}\n`)
const exact = reference => native('get_conversation', { reference })
const revision = chat => ({ sessionId: chat.sessionId, draftId: chat.draftId, expectedRevision: chat.revision })
const begin = (owner, draftId = randomUUID(), sessionId = 'perf-session') => native('begin_record_chat', { request: { sessionId, draftId, record: owner } })
const history = scope => native('list_chat_history', { scope })

async function proof(lane, kind, details) {
  const ui = await browser.execute(() => ({ title: document.querySelector('[aria-label="Session title"]')?.value,
    messages: document.querySelectorAll('.chat-message').length, composer: document.querySelector('.session-chat textarea')?.value,
    text: document.body.innerText.slice(-12000) }))
  await browser.saveScreenshot(join(out, `lane-${lane}-${phase}.png`))
  receipt.cases.push({ lane, kind, details, ui })
  persist()
}
async function openSession(title) {
  await click(`[role="option"]*=${title}`)
  await browser.waitUntil(() => browser.execute(title => document.querySelector('.session-context-header')?.textContent?.includes(title) === true, title))
}
async function showNotes(title) {
  await openSession(title)
  await click('[role="tab"]*=Note')
  await browser.waitUntil(async () => await $('[aria-label="Session title"]').getValue() === title)
  await click('button=Ask AI')
  await $('.chat-messages').waitForDisplayed()
}
async function canonicalNote(sessionId, noteId) {
  const { noteEntry } = await native('open_session_note_state', { id: sessionId })
  assert.equal(noteEntry.id, noteId)
  assert.equal(noteEntry.sessionId, sessionId)
  const storedRevision = JSON.parse(execFileSync('python3', ['-c', `import sqlite3,json,pathlib,sys
with sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+"?mode=ro",uri=True) as db:
 row=db.execute("SELECT revision FROM entries WHERE id=? AND session_id=? AND type='note'",(sys.argv[2],sys.argv[3])).fetchone()
 assert row is not None, "Canonical Note must exist in its Session"
 print(json.dumps(row[0]))`, join(data, 'qa-scribe.sqlite'), noteId, sessionId], { encoding: 'utf8', timeout: 5000 }))
  return { noteEntry, revision: storedRevision }
}
function legacyProjection(path) {
  const source = join(ownershipFixture, 'v18.sqlite')
  return JSON.parse(execFileSync('python3', ['-c', `import sqlite3,json,sys
old=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro&immutable=1',uri=True)
db=sqlite3.connect('file:'+sys.argv[2]+'?mode=ro'+('&immutable=1' if sys.argv[1]==sys.argv[2] else ''),uri=True)
tables=[r[0] for r in old.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'chat_%' OR name='attachments') ORDER BY name")]
result={}
for table in tables:
 columns=[r[1] for r in old.execute('PRAGMA table_info('+table+')')]
 query='SELECT '+','.join(columns)+' FROM '+table+' ORDER BY rowid'
 result[table]=db.execute(query).fetchall()
print(json.dumps(result))`, source, path], { encoding: 'utf8', timeout: 5000 }))
}

let originalNotes
let recordChats

describe('I1 migration and hidden conversation boundaries', () => {
  after(() => {
    receipt.providerExecutions = readdirSync(env.QA_SCRIBE_E2E_FIXTURE_DIR).filter(name => /exec-\d+\.started$/.test(name))
    assert.deepEqual(receipt.providerExecutions, [])
    receipt.completed = receipt.cases.length === (phase === 'initial' ? 9 : 1)
    persist()
  })

  if (phase !== 'initial') {
    it('lane 3 reopens the same migrated Notes in another native process', async () => {
      const saved = JSON.parse(readFileSync(join(data, 'i1-notes-before.json'), 'utf8'))
      await showNotes('Native UI performance fixture')
      const chat = await exact(notesRef)
      assert.deepEqual(chat, saved)
      assert.equal(await $('.chat-composer textarea').getValue(), 'ISOLATION_ACTIVE_UNSENT_INPUT')
      await proof(3, 'native-reopen-and-exact-read', { draftId: chat.draftId, revision: chat.revision, phase })
    })
    return
  }

  it('lane 1 upgrades frozen active Notes without losing any legacy cell', async () => {
    assert.deepEqual(legacyProjection(join(data, 'qa-scribe.sqlite')), legacyProjection(join(ownershipFixture, 'v18.sqlite')))
    await showNotes('Native UI performance fixture')
    originalNotes = await exact(notesRef)
    assert.equal(originalNotes.composer, 'ISOLATION_ACTIVE_UNSENT_INPUT')
    assert.equal(originalNotes.messages.length, 100)
    assert.equal(originalNotes.messages.flatMap(m => m.images).length, 4)
    assert.equal(await $('.chat-composer textarea').getValue(), originalNotes.composer)
    assert.equal((await $$('.chat-message')).length, 100)
    writeFileSync(join(data, 'i1-notes-before.json'), JSON.stringify(originalNotes))
    await proof(1, 'native-notes-ui-and-sqlite-conservation', { reference: notesRef, messages: 100 })
  })

  it('lane 2 retains submitted Notes and its receipt', async () => {
    await showNotes('Isolation submitted Notes fixture')
    const reference = { sessionId: 'isolation-submitted', draftId: 'isolation-submitted-chat' }
    const chat = await exact(reference)
    assert.equal(chat.submission.noteId, 'isolation-submitted-note')
    const note = await canonicalNote(reference.sessionId, 'isolation-submitted-note')
    const replay = await native('submit_chat', { request: { scope: { ...revision(chat), expectedRevision: 0 }, noteId: chat.submission.noteId,
      expectedNoteBody: '', expectedNoteBodyJson: null, expectedNoteBodyFormat: null } })
    assert.deepEqual(replay, chat.submission)
    assert.deepEqual(await canonicalNote(reference.sessionId, 'isolation-submitted-note'), note)
    await proof(2, 'native-submitted-notes-and-receipt-fixture', { receipt: replay })
  })

  it('lane 4 keeps mixed snapshots and every competing stage readable', async () => {
    await showNotes('Isolation legacy mixed staged fixture')
    const chat = await exact(mixedRef)
    assert.equal(chat.messages.length, 10)
    assert.equal(chat.proposals.length, 3)
    assert.deepEqual([...new Set(chat.messages.map(m => m.context.kind))].sort(), ['finding', 'session', 'test_cases_draft'])
    const entries = await history({ kind: 'session', sessionId: mixedRef.sessionId })
    assert.equal(entries[0].unresolvedStages.length, 3)
    assert.equal(entries[0].unresolvedStages.filter(s => s.record.kind === 'finding').length, 2)
    assert.equal((await $$('.chat-message')).length, 10)
    await proof(4, 'native-legacy-notes-and-history-api', { stages: entries[0].unresolvedStages })
  })

  it('lane 5 exact-reads archived Notes and rejects mutation', async () => {
    const entries = await history({ kind: 'notes', sessionId: notesRef.sessionId })
    const archived = entries.find(e => e.reference.draftId === 'isolation-history-000')
    assert.equal(archived.archived, true)
    const chat = await exact(archived.reference)
    assert.equal(chat.messages.length, 10)
    await assert.rejects(native('save_chat_composer', { request: { scope: revision(chat), composer: 'Must fail', mode: chat.mode } }))
    assert.deepEqual(await exact(archived.reference), chat)
    await proof(5, 'scoped-history-and-exact-read-fixture', { reference: archived.reference, messages: 10 })
  })

  it('lane 6 hidden record owners leave the visible Notes untouched', async () => {
    const cases = { kind: 'test_cases_draft', recordId: 'isolation-mixed-tests' }
    recordChats = [await begin(record), await begin(cases, randomUUID(), 'isolation-mixed')]
    for (const [index, chat] of recordChats.entries()) {
      await native('save_chat_composer', { request: { scope: revision(chat), composer: `HIDDEN_RECORD_INPUT_${index}`, mode: 'chat', intent: { kind: 'refine_record' } } })
    }
    await showNotes('Native UI performance fixture')
    assert.deepEqual(await native('get_chat', { sessionId: notesRef.sessionId }), originalNotes)
    assert.equal(await $('.chat-composer textarea').getValue(), originalNotes.composer)
    assert.ok(!(await $('body').getText()).includes('HIDDEN_RECORD_INPUT'))
    await proof(6, 'hidden-boundary-fixture-and-visible-notes', { recordIds: recordChats.map(c => c.draftId) })
  })

  it('lane 7 replays one UUID and rejects a different owner without changing activity', async () => {
    const draftId = randomUUID()
    const chat = await begin(record, draftId)
    assert.deepEqual(await begin(record, draftId), chat)
    await assert.rejects(begin({ kind: 'finding', recordId: 'different-record' }, draftId))
    const entries = await history({ kind: 'record', sessionId: notesRef.sessionId, record })
    assert.equal(entries.filter(e => e.reference.draftId === draftId).length, 1)
    await proof(7, 'launch-replay-boundary-fixture', { draftId })
  })

  it('lane 8 rejects record Note submission and Notes restart', async () => {
    const chat = await exact({ sessionId: recordChats[0].sessionId, draftId: recordChats[0].draftId })
    const note = await canonicalNote(chat.sessionId, 'perf-note')
    await assert.rejects(native('submit_chat', { request: { scope: revision(chat), noteId: 'perf-note', expectedNoteBody: '', expectedNoteBodyJson: null, expectedNoteBodyFormat: null } }))
    await assert.rejects(native('restart_chat', { request: { scope: revision(chat) } }))
    assert.deepEqual(await canonicalNote(chat.sessionId, 'perf-note'), note)
    assert.deepEqual(await exact({ sessionId: chat.sessionId, draftId: chat.draftId }), chat)
    await proof(8, 'notes-purpose-boundary-fixture', { draftId: chat.draftId })
  })

  it('lane 9 explicitly reviews one original legacy stage and saves through its record editor', async () => {
    await openSession('Isolation legacy mixed staged fixture')
    await click('[role="tab"]*=Findings')
    const list = await $('.record-master-list')
    const button = await list.$('button*=Legacy mixed finding')
    await button.waitForClickable()
    await button.click()
    await click('button=Ask AI')
    await $('.ask-ai-panel textarea').waitForDisplayed()
    const chat = await exact(mixedRef)
    const proposal = chat.proposals.find(p => p.after.title === 'Legacy refined title 0')
    assert.equal(proposal.state.kind, 'staged')
    const panel = await $('.chat-proposal')
    const review = await panel.$('button=Review refinement')
    await review.scrollIntoView(); await review.waitForClickable(); await review.click()
    const apply = await panel.$('button=Apply to editor')
    await apply.scrollIntoView(); await apply.waitForClickable(); await apply.click()
    await browser.waitUntil(async () => await $('.record-detail-pane input[aria-label="Finding title"]').getValue() === proposal.after.title)
    const save = await (await $('.record-detail-pane')).$('button=Save')
    await save.waitForClickable(); await save.click()
    await browser.waitUntil(async () => (await exact(mixedRef)).proposals.find(p => p.id === proposal.id).state.kind === 'saved')
    const saved = (await exact(mixedRef)).proposals.find(p => p.id === proposal.id)
    assert.equal(saved.state.stage.id, proposal.state.stage.id)
    const record = (await native('list_findings', { sessionId: mixedRef.sessionId })).find(r => r.id === proposal.target.snapshot.recordId)
    assert.equal(record.title, proposal.after.title)
    await proof(9, 'existing-native-review-apply-and-guarded-save', { proposalId: proposal.id, stageId: saved.state.stage.id })
  })

  it('lane 10 retains a deleted source conversation and permits only exact replay', async () => {
    const source = await native('create_finding', { draft: { sessionId: notesRef.sessionId, title: 'Synthetic deleted source', body: '<p>Source</p>', kind: 'bug', bodyJson: null, bodyFormat: 'html', metadataJson: null } })
    const owner = { kind: 'finding', recordId: source.id }
    const chat = await begin(owner)
    await openSession('Native UI performance fixture')
    await click('[role="tab"]*=Findings')
    const list = await $('.record-master-list')
    const button = await list.$(`button*=${source.title}`)
    await button.waitForClickable()
    await button.click()
    assert.equal(await $('.record-detail-pane .record-title').getText(), source.title)
    await click(`[aria-label="Delete ${source.title}"]`)
    assert.ok((await (await $('dialog[open]')).getText()).includes(source.title))
    await click('dialog button=Delete finding permanently')
    await browser.waitUntil(async () => !(await native('list_findings', { sessionId: source.sessionId })).some(record => record.id === source.id))
    assert.deepEqual(await begin(owner, chat.draftId), chat)
    await assert.rejects(begin(owner))
    assert.deepEqual(await exact({ sessionId: chat.sessionId, draftId: chat.draftId }), chat)
    assert.equal((await history({ kind: 'record', sessionId: chat.sessionId, record: owner }))[0].reference.draftId, chat.draftId)
    assert.deepEqual(await exact(notesRef), originalNotes)
    await proof(10, 'existing-native-record-delete-and-retained-conversation-fixture', { draftId: chat.draftId, deletedRecordId: source.id })
  })
})
