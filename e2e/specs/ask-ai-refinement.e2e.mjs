import { click, selected, recoverExact, exact } from './ask-ai-isolation-proof.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { create, database, fill, fixture, native, out, save, tab } from './composer-proof.mjs'
import { openCreationAi } from './creation-helpers.mjs'
import { imageFixture } from '../fixtures/chat-images-provider.mjs'

const composer = '.ask-ai-panel:not([hidden]) textarea'
let sequence = 0
let session
let record
let kind
const evidence = []
const table = () => kind === 'finding' ? 'findings' : 'drafts'
const titleInput = () => `[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`
const count = () => readdirSync(fixture).filter(name => /^codex-exec-\d+\.started$/.test(name)).length
const chat = selected
let responseReference
const turns = new Map()
const stored = async () => (await native(kind === 'finding' ? 'list_findings' : 'list_drafts', { sessionId: session.id })).find(item => item.id === record.id)
const proposal = async () => (await chat()).proposals.at(-1)
async function panel() { return (await $$('.chat-proposal')).at(-1) }
async function control(label) { const target = await (await panel()).$(`button=${label}`); await target.scrollIntoView(); await target.waitForClickable(); await target.click() }
async function proof(name, facts = {}) {
  evidence.push({ name, record: await stored(), proposal: await proposal(), ...facts })
  writeFileSync(join(out, 'refinement-outcomes.json'), JSON.stringify(evidence, null, 2))
  await browser.saveScreenshot(join(out, `${name}.png`))
}
function sql(statement, args = []) {
  return execFileSync('python3', ['-c', 'import sqlite3,json,sys\nwith sqlite3.connect(sys.argv[1]) as db:\n db.execute(sys.argv[2],json.loads(sys.argv[3]))', database, statement, JSON.stringify(args)], { encoding: 'utf8', timeout: 5000 })
}
function guard(value, name = table()) {
  const data = [name, value.sessionId, value.id, [value.title, value.body, value.bodyJson, value.bodyFormat ?? 'html', value.kind, value.metadataJson]]
  return { sessionId: value.sessionId, expectedStoredBase: createHash('sha256').update(JSON.stringify(data)).digest('hex'), origin: { kind: 'editor' } }
}
async function ask() { await click('button=Ask AI'); await $(composer).waitForDisplayed() }
async function setup(recordKind = 'finding', generated = false) {
  kind = recordKind
  if (await $('[role="tab"]').isExisting()) await tab('Note')
  await click('button=New Session')
  const sessionTitle = `Synthetic R1 Session ${++sequence}`
  await fill('[aria-label="Session title"]', sessionTitle)
  await fill('[aria-label="Note body"]', 'Original Session Note.')
  await browser.waitUntil(async () => (await native('list_sessions')).some(item => item.title === sessionTitle))
  session = (await native('list_sessions')).find(item => item.title === sessionTitle)
  await browser.waitUntil(async () => (await native('list_entries', { sessionId: session.id })).some(item => item.entryType === 'note' && item.body.includes('Original Session Note.')))
  await tab(kind === 'finding' ? 'Findings' : 'Test cases')
  await create(kind === 'finding' ? 'finding' : 'testware')
  if (generated) {
    await openCreationAi('testware')
    const index = count() + 1
    await click('dialog button=Generate')
    await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
    writeFileSync(join(fixture, `codex-exec-${index}.release`), 'Release synthetic generation')
    await $('.creation-composer').waitForExist({ reverse: true })
    await $('.record-detail-pane .record-title').waitForDisplayed()
  } else {
    await fill(titleInput(), `Original ${recordKind} ${sequence}`)
    await fill('[aria-label="Creation draft body"]', 'Original expected result.')
    await save(kind === 'finding' ? 'finding' : 'testware')
  }
  record = (await native(kind === 'finding' ? 'list_findings' : 'list_drafts', { sessionId: session.id }))[0]
  await ask()
}
async function start(text = 'Refine this expected result') {
  const index = count() + 1
  let input = await chat()
  if (input.composerIntent.kind === 'message' && input.messages.length) { await click('[aria-label="Close Ask AI"]'); await $('.ask-ai-panel--record').waitForDisplayed({ reverse: true }); await ask(); await browser.waitUntil(async () => (await chat()).draftId !== input.draftId); input = await chat() }
  const existingProposals = input.proposals.length
  await fill(composer, text)
  responseReference = { sessionId: input.sessionId, draftId: input.draftId }; turns.set(index, responseReference)
  await click('button=Send')
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
  await $('.chat-partial').waitForDisplayed()
  assert.match(await $('.chat-partial').getText(), /Preparing suggested changes/)
  assert.doesNotMatch(await $('.chat-partial').getText(), /requestId|"version"|"refinement"/)
  assert.equal((await chat()).proposals.length, existingProposals)
  assert.equal((await stored()).title, record.title)
  return index
}
async function complete(index) {
  writeFileSync(join(fixture, `codex-exec-${index}.release`), 'Release synthetic refinement', { flag: 'wx' })
  await browser.waitUntil(async () => (await chat()).messages.at(-1)?.role === 'assistant')
  await $('.chat-proposal').waitForDisplayed()
  assert.doesNotMatch(await $('.chat-message-assistant').getText(), /requestId|"version"/)
  await (await panel()).$('button=Apply to editor').waitForDisplayed()
}
async function apply() { await control('Apply to editor'); await browser.waitUntil(async () => (await proposal()).state.kind === 'staged') }
async function recordButton(label) { const target = await (await $('.record-detail-pane')).$(`button=${label}`); await target.waitForClickable(); await target.click() }
async function discard() { const target = await (await $('.record-detail-pane')).$('button=Discard'); await target.waitForClickable(); await target.click() }
async function saveEditor() { const target = await (await $('.record-detail-pane')).$('button=Save'); await target.waitForClickable(); await target.click(); await browser.waitUntil(async () => (await proposal()).state.kind === 'saved') }
async function localTitle() { return (await $(titleInput())).getValue() }
async function select(title) { const target = await (await $('.record-master-list')).$(`button*=${title}`); await target.waitForClickable(); await target.click() }

describe('Reviewed local refinement in shared native chat', () => {
  it('reviews exact values, hides partial JSON, applies once without saving and uses ordinary guarded Save', async () => {
    await setup()
    const index = await start(); await complete(index)
    assert.match(await (await panel()).$('[aria-label="Before refinement"]').getText(), /Original expected result/)
    assert.match(await (await panel()).$('[aria-label="After refinement"]').getText(), /shows a receipt/)
    await apply()
    assert.equal(await localTitle(), `${record.title} refined`)
    assert.equal((await stored()).title, record.title)
    assert.equal(await (await $('.ask-ai-panel:not([hidden])')).$('button=Start new conversation').isExisting(), false)
    assert.match(await $('[aria-label="Chat source"]').getText(), /Unsaved edits included/)
    assert.match(await (await panel()).getText(), /applied to the local editor and not saved/)
    const id = (await proposal()).state.stage.id
    await control('Apply to editor')
    assert.equal((await proposal()).state.stage.id, id)
    assert.equal(await localTitle(), `${record.title} refined`)
    await proof('lane-1-reviewed-dirty')
    await saveEditor()
    const saved = await stored()
    assert.equal(saved.title, `${record.title} refined`)
    assert.equal(saved.bodyFormat, 'tiptap_json')
    assert.match(saved.body, /shows a receipt/)
    assert.match(saved.bodyJson, /shows a receipt/)
    await proof('lane-1-saved')
    assert.equal((await native('get_chat', { sessionId: session.id })).messages.length, 0)
    const note = (await native('list_entries', { sessionId: session.id })).find(item => item.entryType === 'note')
    assert.match(note.body, /Original Session Note/); assert.doesNotMatch(note.body, /Saved through the record editor|requestId|"version"/)
    assert.deepEqual(await stored(), saved)
  })

  it('uses the same proposal path for manual and generated Test cases', async () => {
    for (const generated of [false, true]) {
      await setup('test_cases_draft', generated)
      const index = await start(); await complete(index); await apply()
      assert.equal((await stored()).title, record.title)
      assert.equal(await localTitle(), `${record.title} refined`)
      await saveEditor()
      assert.equal((await stored()).kind, 'testware')
      await proof(generated ? 'lane-2-generated-cases' : 'lane-2-manual-cases')
    }
  })

  it('preserves managed images and unknown metadata while reviewing labeled finding fields', async () => {
    await setup()
    const image = await native('import_clipboard_screenshot', { sessionId: session.id, entryId: null, filename: 'evidence.png', dataUrl: `data:image/png;base64,${readFileSync(imageFixture.path).toString('base64')}` })
    const document = { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original expected result.' }] }, { type: 'image', attrs: { attachmentId: image.id, src: `qa-scribe-attachment://${image.id}`, alt: 'Evidence' } }] } }
    const outcome = await native('update_finding', { id: record.id, patch: { body: `<p>Original expected result.</p><img src="qa-scribe-attachment://${image.id}" alt="Evidence">`, bodyJson: JSON.stringify(document), bodyFormat: 'tiptap_json', metadataJson: JSON.stringify({ severity: 'low', custom: { preserved: true } }) }, guard: guard(record) })
    assert.equal(outcome.kind, 'saved')
    await browser.refresh()
    await $('.record-detail-pane .record-title').waitForDisplayed(); await ask()
    record = await stored()
    const index = await start('Refine expected result and metadata'); await complete(index)
    const fields = await (await panel()).$('[aria-label="Suggested finding field changes"]')
    assert.match(await fields.getText(), /Severity/); assert.match(await fields.getText(), /Low severity to High severity/)
    assert.doesNotMatch(await fields.getText(), /custom|preserved|metadataJson/)
    await apply(); await saveEditor()
    const saved = await stored()
    assert.deepEqual(JSON.parse(saved.metadataJson), { severity: 'high', custom: { preserved: true } })
    assert.equal(JSON.parse(saved.bodyJson).doc.content.at(-1).attrs.attachmentId, image.id)
    await proof('lane-3-images-metadata')
  })

  it('rejects stale local edits while preserving the newer title and displays the reason beside Apply', async () => {
    await setup()
    const index = await start()
    await recordButton('Edit'); await fill(titleInput(), 'Newer local edit')
    await complete(index); await control('Apply to editor')
    await browser.waitUntil(async () => /local editor changed/.test(await (await panel()).getText()))
    assert.equal(await localTitle(), 'Newer local edit')
    assert.equal((await stored()).title, record.title)
    await proof('lane-4-stale-local'); await discard()
  })

  it('rejects a second-client stored change atomically and Discard reviews the newer saved record', async () => {
    await setup(); const index = await start(); await complete(index); await apply()
    sql('UPDATE findings SET title=? WHERE id=?', ['Newer stored title', record.id])
    await recordButton('Save')
    await browser.waitUntil(async () => /Use the record editor Discard/.test(await $('.ask-ai-panel:not([hidden])').getText()))
    assert.equal(await localTitle(), `${record.title} refined`)
    assert.equal((await stored()).title, 'Newer stored title')
    assert.equal((await proposal()).state.kind, 'staged')
    await proof('lane-6-stale-stored'); await discard()
    await browser.waitUntil(async () => (await proposal()).state.kind === 'undone')
    assert.equal(await $('.record-detail-pane .record-title').getText(), 'Newer stored title')
  })

  it('Discard restores the stored record and a failed Save retains the dirty editor and recoverable stage', async () => {
    await setup(); let index = await start(); await complete(index); await apply(); await discard()
    assert.equal(await $('.record-detail-pane .record-title').getText(), record.title)
    assert.equal((await stored()).title, record.title)
    index = await start(); await complete(index); await apply()
    sql(`CREATE TRIGGER r1_fail_save BEFORE UPDATE ON findings WHEN OLD.id='${record.id}' BEGIN SELECT RAISE(ABORT, 'Synthetic R1 failed Save'); END`)
    await recordButton('Save')
    await browser.waitUntil(async () => (await $('[role="alert"]').getText()).includes('Synthetic R1 failed Save'))
    assert.equal(await localTitle(), `${record.title} refined`)
    assert.equal((await proposal()).state.kind, 'staged')
    assert.equal((await stored()).title, record.title)
    await proof('lane-7-failed-save')
    sql('DROP TRIGGER r1_fail_save'); await saveEditor()
  })

  it('never redirects a proposal when the selected record changes', async () => {
    await setup(); await click('[aria-label="Close Ask AI"]')
    await create('finding'); await fill(titleInput(), 'Other finding'); await fill('[aria-label="Creation draft body"]', 'Other evidence'); await save('finding')
    await select(record.title); await ask(); const index = await start()
    await click('[aria-label="Close Ask AI"]'); await select('Other finding'); await ask()
    writeFileSync(join(fixture, `codex-exec-${index}.release`), 'Release hidden refinement')
    await browser.waitUntil(async () => (await exact(turns.get(index))).proposals.length === 1)
    assert.deepEqual((await chat()).proposals, [])
    assert.equal(await $('.record-detail-pane .record-title').getText(), 'Other finding')
    assert.equal((await stored()).title, record.title)
    assert.equal((await exact(turns.get(index))).proposals[0].target.snapshot.recordId, record.id)
    await proof('lane-8-navigation')
  })

  it('retains deleted-target history and refuses to apply it', async () => {
    await setup(); const index = await start()
    await click(`[aria-label="Delete ${record.title}"]`); await click('dialog button=Delete finding permanently')
    await recoverExact(turns.get(index)); await $(composer).waitForDisplayed()
    await complete(index)
    assert.equal(await (await panel()).$('button=Apply to editor').isEnabled(), false)
    assert.equal(await stored(), undefined)
    assert.equal((await proposal()).target.snapshot.recordId, record.id)
    await proof('lane-9-deleted-target')
  })

  it('offers recovery without restoring automatically and retains open-ended chat and malformed-response fallback', async () => {
    await setup(); const index = await start(); await complete(index); await apply()
    const stageId = (await proposal()).state.stage.id
    const recoveredReference = { sessionId: session.id, draftId: (await chat()).draftId }; await browser.refresh(); await $('.record-detail-pane .record-title').waitForDisplayed(); await recoverExact(recoveredReference); await $(composer).waitForDisplayed()
    assert.equal(await $('.record-detail-pane .record-title').getText(), record.title)
    assert.equal((await proposal()).state.stage.id, stageId)
    await control('Apply to editor')
    assert.equal(await localTitle(), `${record.title} refined`)
    await discard(); await proof('lane-10-offered-recovery')
    await fill(composer, 'An unrelated free-form testing question')
    const normalIndex = count() + 1; await click('button=Send')
    await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${normalIndex}.started`)))
    writeFileSync(join(fixture, `codex-exec-${normalIndex}.release`), 'Release ordinary chat')
    await browser.waitUntil(async () => (await chat()).messages.at(-1)?.text.includes('Synthetic general chat'))
    const retainedChat = await chat()
    const before = retainedChat.proposals.length
    const bad = await start('invalid envelope')
    writeFileSync(join(fixture, `codex-exec-${bad}.release`), 'Release malformed response')
    await browser.waitUntil(async () => (await chat()).messages.at(-1)?.response?.warning?.startsWith('No editable proposal'))
    assert.equal((await chat()).proposals.length, 0)
    assert.equal((await exact({ sessionId: retainedChat.sessionId, draftId: retainedChat.draftId })).proposals.length, before)
    assert.match((await chat()).messages.at(-1).text, /Must never apply/)
    assert.equal((await stored()).title, record.title)
  })
  it('resolves an uninstalled prepared stage while retaining and saving newer local edits', async () => {
    await setup(); const index = await start(); await complete(index)
    const current = await chat()
    await native('resolve_refinement', { request: { scope: { sessionId: current.sessionId, draftId: current.draftId, expectedRevision: current.revision }, proposalId: current.proposals.at(-1).id, action: 'stage' } })
    const recoveredReference = { sessionId: session.id, draftId: (await chat()).draftId }; await browser.refresh(); await $('.record-detail-pane .record-title').waitForDisplayed(); await recoverExact(recoveredReference); await $(composer).waitForDisplayed()
    await recordButton('Edit'); await fill(titleInput(), 'Newer edits after prepared recovery')
    await control('Apply to editor')
    await browser.waitUntil(async () => /local editor changed/.test(await (await panel()).getText()))
    await control('Keep current edits')
    await browser.waitUntil(async () => (await proposal()).state.kind === 'abandoned')
    assert.equal(await localTitle(), 'Newer edits after prepared recovery')
    await recordButton('Save')
    await browser.waitUntil(async () => (await stored()).title === 'Newer edits after prepared recovery')
    assert.equal((await proposal()).state.kind, 'abandoned')
    await proof('lane-11-abandoned-preparation')
  })

})
