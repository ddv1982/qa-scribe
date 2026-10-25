import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { RefinementProposal } from '../bindings'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { recordWriteGuard } from './recordWriteGuards'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { open, saveCurrent, currentRecord, storageOutcome } from './sessionChat.proposals.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each([['finding', false], ['finding', true], ['test_cases_draft', false], ['test_cases_draft', true]] as const)('%s a replacement stage cannot rebase retained edits onto B; recovered %s', async (kind, recovered) => {
  const { result, record, proposal, after, base, setChat } = await open(kind)
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  const remote = { ...record, title: 'Newer stored title', ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Newer stored body B')) }
  const remoteBase = await recordWriteGuard(remote, kind === 'finding' ? 'findings' : 'drafts')
  const storage = storageOutcome(remote, kind)
  const save = kind === 'finding' ? api.updateFinding : api.updateDraft
  save.mockImplementation(storage.write)
  await act(async () => { await saveCurrent(result.current, kind) })
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'undo') })
  if (proposal.target.kind === 'session') throw new Error('Missing record context')
  const replacement: RefinementProposal = { ...proposal, id: 'proposal-2', target: { ...proposal.target, snapshot: { ...proposal.target.snapshot, storedBaseToken: remoteBase.expectedStoredBase } }, state: recovered ? { kind: 'staged', stage: { id: 'stage-2', before: proposal.before, after, storedBaseToken: remoteBase.expectedStoredBase } } : { kind: 'offered' } }
  const offered = chatFixture({ draftId: 'chat-session-1', revision: 3, proposals: [replacement] })
  setChat(offered)
  await act(async () => { await result.current.sessionChat.onRefresh?.() })
  api.resolveRefinement.mockImplementationOnce(async () => {
    const staged = chatFixture({ ...offered, revision: offered.revision + 1, proposals: [{ ...replacement, state: { kind: 'staged', stage: { id: 'stage-2', before: proposal.before, after, storedBaseToken: remoteBase.expectedStoredBase } } }] })
    setChat(staged)
    return staged
  })
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-2', 'stage') })
  expect(currentRecord(result.current, kind).title).toBe('Refined title')
  let saved = true
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(storage.read().title).toBe('Newer stored title')
  expect(storage.read().body).toBe('<p>Newer stored body B</p>')
  expect(saved).toBe(false)
  expect(save.mock.calls.at(-1)?.[2]).toEqual({ sessionId: record.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'proposal', stageId: 'stage-2' } })
})
