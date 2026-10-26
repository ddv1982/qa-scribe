import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ask, close, composer, createReceipt, exact, executions, fill, finish, fixture, manual, managedImageHash, native, notes, panel, pasteImage, recoverExact, reviewScreenshot, selectRecord, selected, start, tab, click } from './ask-ai-isolation-proof.mjs'
import { resize } from './chat-handoff-proof.mjs'
import { openCreationAi } from './creation-helpers.mjs'

const { receipt, persist, proof } = createReceipt('initial')
let session
let records
let notesBefore
const list = kind => native(kind === 'finding' ? 'list_findings' : 'list_drafts', { sessionId: session.id })
async function show(kind, record) {
  await tab(kind === 'finding' ? 'Findings' : 'Test cases')
  await selectRecord(record.title)
  return ask()
}
async function generate(kind) {
  await tab(kind === 'finding' ? 'Findings' : 'Test cases')
  const before = new Set((await list(kind)).map(row => row.id))
  await $('.record-detail-pane').waitForDisplayed()
  assert.ok(before.size > 0)
  receipt.generationHydration ??= []
  receipt.generationHydration.push({ kind, existingIds: [...before], detailBeforeGeneration: await $('.record-detail-pane').getText(), entrypoint: 'Visible creation composer, which force-reloads the saved destination' }); persist()
  await openCreationAi(kind === 'finding' ? 'finding' : 'testware')
  const index = executions() + 1
  await click('dialog button=Generate')
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
  writeFileSync(join(fixture, `codex-exec-${index}.release`), 'Release synthetic generation')
  await $('.creation-composer').waitForExist({ reverse: true })
  await browser.waitUntil(async () => (await list(kind)).some(row => !before.has(row.id)))
  const record = (await list(kind)).find(row => !before.has(row.id))
  await selectRecord(record.title)
  return record
}
async function stored(kind, id) { return (await list(kind)).find(row => row.id === id) }
async function settled() { await browser.waitUntil(async () => (await $('button=Send')).isEnabled()) }

describe('Minimal Ask AI in the built native application', () => {
  before(async () => {
    await click('button=New Session')
    await fill('[aria-label="Session title"]', 'Synthetic minimal Ask AI')
    await fill('[aria-label="Note body"]', 'Synthetic independent Notes evidence.')
    await browser.waitUntil(async () => (await native('list_sessions')).some(row => row.title === 'Synthetic minimal Ask AI'))
    session = (await native('list_sessions')).find(row => row.title === 'Synthetic minimal Ask AI')
    await manual('finding', 'Checkout hides the payment error after retry')
    await manual('test_cases_draft', 'Retry a declined payment')
    records = [
      { kind: 'finding', origin: 'manual', record: (await list('finding'))[0] },
      { kind: 'test_cases_draft', origin: 'manual', record: (await list('test_cases_draft'))[0] },
      { kind: 'finding', origin: 'generated', record: await generate('finding') },
      { kind: 'test_cases_draft', origin: 'generated', record: await generate('test_cases_draft') },
    ]
    await tab('Note'); await click('button=Ask AI')
    const turn = await start('Notes conversation stays in Notes'); await finish(turn)
    await fill(composer, 'Literal unsent Notes request. 雪 4827.'); await pasteImage()
    await resize(1280, 642)
    assert.equal(await $('[aria-label="Note body"]').isDisplayed(), true)
    assert.equal(await $('.session-workspace .ask-ai-trigger').getAttribute('aria-expanded'), 'true')
    await reviewScreenshot('notes-ask-ai')
    const retainedNotes = await notes(session.id)
    await click('.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]')
    assert.equal(await $('.session-workspace .ask-ai-trigger').getAttribute('aria-expanded'), 'false')
    await click('button=Ask AI')
    assert.equal(await $(composer).getValue(), 'Literal unsent Notes request. 雪 4827.')
    assert.deepEqual((await notes(session.id)).composerImages, retainedNotes.composerImages)
    assert.equal((await notes(session.id)).draftId, retainedNotes.draftId)
    await resize(800, 620)
    const notesReachable = await browser.execute(() => {
      const panel = document.querySelector('.ask-ai-panel--notes')
      return ['textarea', '[aria-label="Attach images"]', '.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]'].every(selector => {
        const rect = panel.querySelector(selector).getBoundingClientRect()
        return rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight
      })
    })
    assert.equal(notesReachable, true)
    await reviewScreenshot('notes-ask-ai-narrow')
    await click('.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]')
    assert.equal(await browser.execute(() => document.activeElement?.matches('.session-workspace .ask-ai-trigger')), true)
    await click('button=Ask AI')
    await resize(1280, 642)
    notesBefore = await notes(session.id)
  })
  it('1 launches fresh on manual and generated records without changing Notes', async () => {
    await resize(1280, 642)
    const cachedLaunches = []
    for (const kind of ['finding', 'test_cases_draft']) {
      const label = kind === 'finding' ? 'Findings' : 'Test cases'
      await tab(label)
      const title = await $('.record-title').getText()
      const record = (await list(kind)).find(row => row.title === title)
      assert.ok(record)
      await tab('Note')
      await browser.waitUntil(async () => (await notes(session.id)).lastActiveOrder > notesBefore.lastActiveOrder)
      const reactivatedNotes = await notes(session.id)
      assert.deepEqual({ ...reactivatedNotes, lastActiveAt: notesBefore.lastActiveAt, lastActiveOrder: notesBefore.lastActiveOrder }, notesBefore)
      notesBefore = reactivatedNotes
      await tab(label)
      const count = executions()
      const chat = await ask()
      assert.deepEqual(chat.owner, { kind: 'record', sessionId: session.id, record: { kind, recordId: record.id } })
      assert.equal(await $(composer).getValue(), '')
      assert.equal(executions(), count)
      assert.deepEqual(await notes(session.id), notesBefore)
      await reviewScreenshot(`cached-default-${kind}-first-click`)
      cachedLaunches.push({ kind, reference: { sessionId: session.id, draftId: chat.draftId }, recordId: record.id,
        viewport: await browser.execute(() => ({ width: innerWidth, height: innerHeight })), selectionPath: 'Cached default record, Note, return, first Ask AI click without selecting a row' })
      await close()
    }
    const launches = []
    for (const { kind, origin, record } of records) {
      const before = executions()
      const chat = await show(kind, record)
      assert.deepEqual(chat.owner, { kind: 'record', sessionId: session.id, record: { kind, recordId: record.id } })
      assert.equal(chat.composer, ''); assert.deepEqual(chat.composerImages, []); assert.deepEqual(chat.messages, [])
      assert.equal(chat.submission, null); assert.equal(executions(), before)
      assert.deepEqual(await notes(session.id), notesBefore)
      let generatedSend
      if (origin === 'generated') {
        assert.equal(await $(`${panel} [aria-label="Chat source"] strong`).getText(), record.title)
        await fill(composer, 'Explain this generated evidence. 雪')
        assert.equal(await (await $(panel)).$('button=Send').isEnabled(), true)
        const turn = await start()
        const context = turn.payload.messages.at(-1).context
        assert.equal(turn.payload.messages.at(-1).text, 'Explain this generated evidence. 雪')
        assert.deepEqual(context, { kind, snapshot: {
          sessionId: session.id, recordId: record.id, title: kind === 'finding' ? 'E2E finding' : 'Synthetic minimal Ask AI Test Cases',
          documentJson: context.snapshot.documentJson, metadataJson: kind === 'finding' ? null : '{"testwareGeneration":{"customInstructions":null,"depth":"balanced","includeBoundaryCases":true,"includeNegativeCases":true,"includeTestData":true,"outputFormat":"qa_cases","preserveEvidence":true,"technique":"auto"}}',
          recordKind: kind === 'finding' ? 'bug' : 'testware', origin: 'saved', localFingerprint: context.snapshot.localFingerprint, storedBaseToken: context.snapshot.storedBaseToken,
        } })
        assert.deepEqual(JSON.parse(context.snapshot.documentJson), { schemaVersion: 1, doc: { type: 'doc', content: kind === 'finding'
          ? [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'E2E finding' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Deterministic provider output.' }] }]
          : [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'E2E test cases' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deterministic generated case' }] }] }] }],
        } })
        const job = (await native('list_active_ai_action_jobs')).find(row => row.chat?.reference.draftId === chat.draftId)
        assert.deepEqual(job.chat.reference, { sessionId: session.id, draftId: chat.draftId })
        assert.deepEqual((await exact(turn.reference)).messages.at(-1).context, context)
        assert.equal(executions(), before + 1)
        await finish(turn)
        generatedSend = { reference: turn.reference, context, job }
      }
      if (origin === 'manual') await reviewScreenshot(kind === 'finding' ? 'finding' : 'test-case')
      launches.push({ kind, origin, reference: { sessionId: session.id, draftId: chat.draftId }, generatedSend })
      await close()
    }
    await proof(1, { launches, cachedLaunches, notes: notesBefore, notesImageHash: managedImageHash(notesBefore.composerImages[0].attachmentId) })
  })
  it('2 reviews all suggested fields and updates the exact saved record in one action', async () => {
    const viewport = await resize(1024, 642)
    const outcomes = []
    const conversations = []
    for (const entry of records.filter(row => row.origin === 'manual')) {
      const { kind, record } = entry
      await tab(kind === 'finding' ? 'Findings' : 'Test cases')
      await selectRecord(record.title)
      await click('.record-detail-pane button=Edit')
      const localTitle = `${record.title} draft`
      await fill(`[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`, localTitle)
      if (kind === 'finding') await browser.execute(() => {
        const field = document.querySelector('.record-detail-pane .finding-classification-fields select')
        field.value = 'risk'; field.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await ask(); await pasteImage()
      const before = await stored(kind, record.id)
      const turn = await start('Improve the expected result with this evidence.')
      assert.equal(turn.payload.messages.at(-1).context.snapshot.recordId, record.id)
      assert.equal(turn.payload.messages.at(-1).context.snapshot.origin, 'unsaved_editor')
      assert.equal(turn.payload.messages.at(-1).context.snapshot.recordKind, kind === 'finding' ? 'risk' : 'testware')
      assert.equal(turn.payload.messages.at(-1).context.snapshot.title, localTitle)
      assert.equal(turn.payload.messages.at(-1).images.length, 1)
      await finish(turn)
      const suggestion = await $('.chat-proposal')
      await suggestion.waitForDisplayed()
      if (kind === 'finding') {
        assert.match(await suggestion.getText(), /High severity/)
        assert.match(await suggestion.getText(), /Resolved/)
        assert.match(await suggestion.getText(), /Checkout/)
        assert.match(await suggestion.getText(), /DEMO-184/)
        await reviewScreenshot('conversation-proposal')
      }
      assert.equal(await $('button=Review refinement').isExisting(), false)
      assert.deepEqual(await stored(kind, record.id), before)
      await click(kind === 'finding' ? 'button=Update finding' : 'button=Update test case')
      await browser.waitUntil(async () => (await exact(turn.reference)).proposals[0]?.state.kind === 'applied')
      const conversation = await exact(turn.reference)
      assert.deepEqual({ sessionId: conversation.sessionId, draftId: conversation.draftId }, turn.reference)
      assert.deepEqual(conversation.owner, { kind: 'record', sessionId: session.id, record: { kind, recordId: record.id } })
      await browser.waitUntil(async () => (await $('.record-title').getText()) === `${localTitle} refined`)
      await reviewScreenshot(`updated-${kind}`)
      await close()
      const saved = await stored(kind, record.id)
      assert.equal(saved.id, record.id); assert.equal(saved.title, `${localTitle} refined`)
      assert.equal(saved.kind, kind === 'finding' ? 'risk' : 'testware')
      assert.deepEqual(JSON.parse(saved.bodyJson), { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The application keeps the payment error visible after Retry.' }] }] } })
      if (kind === 'finding') assert.deepEqual(JSON.parse(saved.metadataJson), { ...JSON.parse(before.metadataJson ?? '{}'), severity: 'high', status: 'resolved', component: 'Checkout', reference: 'DEMO-184' })
      outcomes.push(saved); entry.record = saved
      conversations.push(conversation)
    }
    await proof(2, { saved: outcomes, conversations, viewport, savePath: 'One Update action commits the record and proposal together' })
  })
  it('3 reclick preserves input and images while a settled reopen starts fresh', async () => {
    const reclickViewport = await resize(1280, 642)
    const { kind, record } = records[0]
    await show(kind, record); await fill(composer, 'Keep this literal input. 雪'); await pasteImage()
    const old = await selected()
    const ref = { sessionId: session.id, draftId: old.draftId }
    await ask()
    assert.equal((await selected()).draftId, old.draftId)
    assert.equal(await $(composer).getValue(), 'Keep this literal input. 雪')
    assert.deepEqual((await selected()).composerImages, old.composerImages)
    const reopenViewport = await resize(1024, 642)
    await close(); const fresh = await ask()
    assert.notEqual(fresh.draftId, old.draftId); assert.equal(fresh.composer, '')
    assert.equal((await exact(ref)).composer, 'Keep this literal input. 雪')
    assert.deepEqual((await exact(ref)).composerImages, old.composerImages)
    await proof(3, { retained: await exact(ref), freshId: fresh.draftId, reclickViewport, reopenViewport })
  })
  it('4 recovers exact hidden unfinished permission without resending', async () => {
    const turn = await start('Review with tool permission.')
    writeFileSync(join(fixture, `codex-exec-${turn.index}.release`), 'Release synthetic permission request')
    await $('[aria-label="Tool permission"]').waitForDisplayed()
    const count = executions()
    await close(); await tab('Test cases')
    await recoverExact(turn.reference)
    await $('[aria-label="Tool permission"]').waitForDisplayed()
    assert.equal((await selected()).draftId, turn.reference.draftId)
    assert.equal(executions(), count)
    assert.equal(await browser.execute(() => document.querySelector('.ask-ai-panel--record textarea').getBoundingClientRect().bottom <= innerHeight), true)
    await reviewScreenshot('recovery-permission')
    await click('button=Approve once')
    await browser.waitUntil(async () => (await exact(turn.reference)).messages.at(-1)?.role === 'assistant')
    assert.equal(executions(), count)
    assert.equal((await exact(turn.reference)).owner.record.recordId, records[0].record.id)
    await close(); const fresh = await ask(); assert.notEqual(fresh.draftId, turn.reference.draftId)
    await close()
    await manual('finding', 'Original recovery source A')
    await manual('finding', 'Fallback B stays unrelated')
    const fallback = (await list('finding')).find(row => row.title === 'Fallback B stays unrelated')
    await selectRecord('Original recovery source A'); await ask()
    const owner = (await selected()).owner
    const missing = await start('Review with tool permission.')
    writeFileSync(join(fixture, `codex-exec-${missing.index}.release`), 'Release synthetic missing-source permission')
    await $('[aria-label="Tool permission"]').waitForDisplayed()
    const permission = await $('[aria-label="Tool permission"]').getText()
    const pending = (await native('list_active_ai_action_jobs')).find(job => job.chat?.reference.draftId === missing.reference.draftId)
    await close()
    await native('delete_finding', { id: owner.record.recordId })
    await browser.refresh()
    await click(`[role="option"]*=${session.title}`); await tab('Note')
    const beforeRecovery = executions()
    await recoverExact(missing.reference)
    await $('.ask-ai-panel--record').waitForDisplayed()
    await $('[aria-label="Tool permission"]').waitForDisplayed()
    const recovered = await selected()
    assert.equal(recovered.draftId, missing.reference.draftId)
    assert.deepEqual(recovered.owner, owner)
    const recoveredJob = (await native('list_active_ai_action_jobs')).find(job => job.jobId === pending.jobId)
    assert.deepEqual(recoveredJob.chat.reference, missing.reference)
    assert.deepEqual(recoveredJob.pendingPermission, pending.pendingPermission)
    assert.equal(await $('[aria-label="Tool permission"]').getText(), permission)
    assert.match(await $('.record-detail-pane').getText(), /Fallback B stays unrelated/)
    assert.match(await $(`${panel} [aria-label="Chat source"]`).getText(), /no longer available/)
    assert.equal(await (await $(panel)).$('button=Send').isEnabled(), false)
    assert.equal(executions(), beforeRecovery)
    assert.deepEqual(await stored('finding', fallback.id), fallback)
    assert.equal(await stored('finding', owner.record.recordId), undefined)
    await reviewScreenshot('missing-source-first-click')
    await proof(4, { reference: turn.reference, providerInvocations: count, missingSource: { reference: missing.reference, owner, permission, pending, recoveredJob, providerInvocationsBefore: beforeRecovery, providerInvocationsAfter: executions(), fallback } })
    await click('button=Deny')
    await browser.waitUntil(async () => (await exact(missing.reference)).messages.at(-1)?.role === 'assistant')
    assert.equal(executions(), beforeRecovery)
    await close(); await show(records[0].kind, records[0].record)
    const reactivatedNotes = await notes(session.id)
    assert.deepEqual({ ...reactivatedNotes, lastActiveAt: notesBefore.lastActiveAt, lastActiveOrder: notesBefore.lastActiveOrder }, notesBefore)
    notesBefore = reactivatedNotes
  })
  it('5 uses typed Jira and follow-up messages through the existing agent path', async () => {
    let turn = await start('Add this to Jira.'); await finish(turn)
    assert.match(await $(panel).getText(), /Which project and configured issue type/)
    assert.equal(await $('.chat-question-choices').isExisting(), false)
    assert.equal(await $('button=Prepare action message').isExisting(), false)
    assert.equal((await selected()).proposals.length, 0)
    turn = await start('Use DEMO Bug, with the current expected result.'); await finish(turn)
    assert.equal(turn.payload.messages.at(-1).text, 'Use DEMO Bug, with the current expected result.')
    assert.equal((await selected()).messages.at(-1).text, 'Synthetic Jira request received for DEMO Bug. No Jira operation occurred.')
    assert.deepEqual(await notes(session.id), notesBefore)
    await proof(5, { messages: (await selected()).messages, externalWrites: false })
  })
  it('6 keeps the composer and controls reachable in a short window and accepts DOM keyboard send', async () => {
    await close(); await ask()
    let turn = await start('Make the expected result clearer.'); await finish(turn)
    await reviewScreenshot('conversation')
    turn = await start('Give a detailed explanation.'); await finish(turn)
    await resize(1100, 620)
    const reachable = await browser.execute(() => {
      const panel = document.querySelector('.ask-ai-panel--record:not([hidden])')
      return ['textarea', '[aria-label="Attach images"]', 'button.action-primary', '.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]'].map(selector => {
        const node = selector === 'button.action-primary' ? [...panel.querySelectorAll('button')].find(button => button.textContent === 'Send') : panel.querySelector(selector)
        const rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight
      })
    })
    assert.deepEqual(reachable, [true, true, true, true])
    await reviewScreenshot('short-window')
    await fill(composer, 'Keyboard follow-up')
    await settled()
    const index = executions() + 1
    const current = await selected()
    await browser.execute(() => {
      const input = document.querySelector('.ask-ai-panel--record:not([hidden]) textarea')
      input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
    await finish({ index, reference: { sessionId: session.id, draftId: current.draftId }, payload: { externalWrites: false } })
    assert.equal((await selected()).messages.at(-2).text, 'Keyboard follow-up')
    await proof(6, { reachable, inputMechanism: 'DOM keyboard events in the maintained native WebView driver' })
    receipt.completed = true; persist()
    await close()
  })
})
