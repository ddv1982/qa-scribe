import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { ChatState, DraftPatch, FindingPatch, RecordWriteGuard, RefinementProposal } from '../bindings'
import { draftFixture, findingFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { editorValue, recordWriteGuard } from './recordWriteGuards'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { open, storageOutcome } from './sessionChat.proposals.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each(['finding', 'test_cases_draft'] as const)('%s delayed Save settles A while B retains its bound stage, body and pinned guard', async kind => {
  const b = kind === 'finding' ? findingFixture({ id: 'record-B', title: 'B before' }) : draftFixture({ id: 'record-B', title: 'B before' })
  const subject = await open(kind, [b])
  const { result, record: a, setConversation, readConversation } = subject
  const aRef = { sessionId: a.sessionId, draftId: 'chat-session-1' }
  const bRef = { sessionId: b.sessionId, draftId: 'conversation-B' }
  const before = editorValue(b)
  const after = { ...before, title: 'B retained proposal', documentJson: richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Literal B proposal body')).bodyJson }
  const base = await recordWriteGuard(b, kind === 'finding' ? 'findings' : 'drafts')
  if (subject.proposal.target.kind === 'session') throw new Error('Record proposal expected')
  const proposal: RefinementProposal = { ...subject.proposal, id: 'proposal-B', target: { kind, snapshot: { ...subject.proposal.target.snapshot, recordId: b.id, title: b.title, documentJson: before.documentJson, storedBaseToken: base.expectedStoredBase } }, before, after }
  setConversation(chatFixture({ ...bRef, owner: { kind: 'record', sessionId: b.sessionId, record: { kind, recordId: b.id } }, mode: 'chat', proposals: [proposal] }))
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction(subject.proposal.id, 'stage') })
  const select = async (reference: typeof aRef, record: typeof a) => {
    await act(async () => {
      result.current.askAi.onSelectRecord({ kind, recordId: record.id, title: record.title, unsaved: true })
      await result.current.conversations.select(reference)
    })
  }
  await select(bRef, b)
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction(proposal.id, 'stage') })
  expect(result.current.sessionChat.proposalControls!.preparedOnly?.has(proposal.id)).toBe(false)
  await select(aRef, a)
  const storedA = storageOutcome(a, kind)
  const storedB = storageOutcome(b, kind)
  const committed = deferred<void>(), release = deferred<void>()
  const command = kind === 'finding' ? api.updateFinding : api.updateDraft
  command.mockImplementation(async (id: string, patch: FindingPatch | DraftPatch, guard: RecordWriteGuard) => {
    const stored = id === a.id ? storedA : storedB
    const saved = await stored.write(id, patch, guard)
    const reference = id === a.id ? aRef : bRef
    const chat = readConversation(reference.draftId)
    const current = chat.proposals![0]
    if (current.state.kind !== 'staged') throw new Error('Save must settle its exact prepared stage')
    const next: ChatState = { ...chat, revision: chat.revision + 1, proposals: [{ ...current, state: { kind: 'saved', stage: current.state.stage } }] }
    setConversation(next)
    if (id === a.id) { committed.resolve(); await release.promise }
    return saved
  })
  const save = (id: string) => kind === 'finding'
    ? result.current.handleSaveFinding(result.current.findings.find(item => item.id === id)!)
    : result.current.handleSaveDraft(result.current.testwareDrafts.find(item => item.id === id)!)
  let saving!: Promise<boolean>
  act(() => { saving = save(a.id) })
  await act(async () => { await committed.promise })
  await select(bRef, b)
  const beforeB = readConversation(bRef.draftId)
  await act(async () => { release.resolve(); expect(await saving).toBe(true) })
  await waitFor(() => expect(result.current.sessionChat.chat?.draftId).toBe(bRef.draftId))
  expect(result.current.sessionChat.chat?.proposals).toEqual(beforeB.proposals)
  expect(result.current.sessionChat.proposalControls!.preparedOnly?.has(proposal.id)).toBe(false)
  expect(storedA.read().title).toBe(subject.after.title)
  expect(storedA.read().bodyJson).toBe(subject.after.documentJson)
  expect(storedB.read().title).toBe('B before')
  expect((kind === 'finding' ? result.current.findings : result.current.testwareDrafts).find(item => item.id === b.id)?.body).toBe('<p>Literal B proposal body</p>')
  await act(async () => { expect(await save(b.id)).toBe(true) })
  expect(command.mock.calls.at(-1)?.[2]).toEqual({ sessionId: b.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'proposal', stageId: 'stage-proposal-B' } })
  expect(storedB.read().body).toBe('<p>Literal B proposal body</p>')
  expect(readConversation(aRef.draftId).proposals![0].state.kind).toBe('saved')
})

