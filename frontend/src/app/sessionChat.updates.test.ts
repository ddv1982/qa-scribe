import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AppliedRefinement, ApplyRefinementRequest } from '../bindings'
import { parseRichEditorDocument, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { open, currentRecord, editTitle, discardCurrent } from './sessionChat.proposals.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

async function ready(kind: 'finding' | 'test_cases_draft') {
  const subject = await open(kind)
  const document = parseRichEditorDocument(subject.after.documentJson)!
  const saved = { ...subject.record, title: subject.after.title, ...richEditorDocumentToStoredBody(document) }
  function commit(request: ApplyRefinementRequest): AppliedRefinement {
    const previous = subject.readConversation(request.reference.draftId)
    const chat = { ...previous, revision: previous.revision + 1, proposals: [{ ...subject.proposal, state: { kind: 'applied' as const } }] }
    subject.setChat(chat)
    return { chat, updated: kind === 'finding' ? { kind, record: saved as import('../bindings').Finding } : { kind, record: saved as import('../bindings').Draft } }
  }
  api.applyRefinement.mockImplementation(async (request: ApplyRefinementRequest) => commit(request))
  return { ...subject, saved, commit, update: () => subject.result.current.proposalControls.onUpdate!('proposal-1') }
}

it.each(['finding', 'test_cases_draft'] as const)('%s Update saves directly without staging or an ordinary Save', async kind => {
  const subject = await ready(kind)
  await act(async () => { await subject.update() })
  expect(api.applyRefinement).toHaveBeenCalledWith({ reference: { sessionId: subject.record.sessionId, draftId: 'chat-session-1' }, proposalId: 'proposal-1' })
  expect(api.resolveRefinement).not.toHaveBeenCalled()
  expect(api.updateFinding).not.toHaveBeenCalled()
  expect(api.updateDraft).not.toHaveBeenCalled()
  expect(currentRecord(subject.result.current, kind)).toEqual(subject.saved)
  expect(subject.result.current.notice).toBe(kind === 'finding' ? 'Finding updated' : 'Test case updated')
})

it.each(['finding', 'test_cases_draft'] as const)('%s retains a manual edit made while Update is in flight', async kind => {
  const subject = await ready(kind)
  const pending = deferred<AppliedRefinement>()
  api.applyRefinement.mockReturnValueOnce(pending.promise)
  let completion!: Promise<void>
  act(() => { completion = subject.update() })
  await waitFor(() => expect(api.applyRefinement).toHaveBeenCalledOnce())
  act(() => editTitle(subject.result.current, kind, 'Newer manual edit'))
  await act(async () => { pending.resolve(subject.commit(api.applyRefinement.mock.calls[0][0])); await completion })
  expect(currentRecord(subject.result.current, kind).title).toBe('Newer manual edit')
  expect(subject.result.current.notice).toContain('newer editor changes are still unsaved')
  act(() => discardCurrent(subject.result.current, kind))
  expect(currentRecord(subject.result.current, kind)).toEqual(subject.saved)
})

it.each(['finding', 'test_cases_draft'] as const)('%s rejects a stale local proposal before any write', async kind => {
  const subject = await ready(kind)
  act(() => editTitle(subject.result.current, kind, 'Newer manual edit'))
  await act(async () => { await subject.update() })
  expect(api.applyRefinement).not.toHaveBeenCalled()
  expect(currentRecord(subject.result.current, kind).title).toBe('Newer manual edit')
  expect(subject.result.current.proposalControls.errors['proposal-1']).toContain('Request a fresh suggestion')
})

it.each(['finding', 'test_cases_draft'] as const)('%s can retry a lost acknowledgement by the same proposal without global recovery state', async kind => {
  const subject = await ready(kind)
  api.applyRefinement.mockImplementationOnce(async (request: ApplyRefinementRequest) => { subject.commit(request); throw new Error('Lost acknowledgement') })
  await act(async () => { await subject.update() })
  expect(subject.result.current.proposalControls.errors['proposal-1']).toContain('retry Update safely')
  expect(subject.result.current.sessionChat.recordWritesPending).toBe(false)
  await act(async () => { await subject.update() })
  expect(api.applyRefinement).toHaveBeenCalledTimes(2)
  expect(api.applyRefinement.mock.calls[0]).toEqual(api.applyRefinement.mock.calls[1])
  expect(currentRecord(subject.result.current, kind)).toEqual(subject.saved)
  expect(subject.result.current.proposalControls.errors['proposal-1']).toBeUndefined()
})
