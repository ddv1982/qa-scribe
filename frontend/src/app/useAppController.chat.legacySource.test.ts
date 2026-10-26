import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { findingFixture } from '../test/fixtures'
import { completedChatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { open } from './sessionChat.proposals.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it('legacy Notes recovery cannot capture the fallback record when its original source is missing', async () => {
  const { result, proposal, after, base, setChat } = await open()
  const stage = { id: 'legacy-stage', before: proposal.before, after, storedBaseToken: base.expectedStoredBase }
  setChat(completedChatFixture({ draftId: 'chat-session-1', revision: 3, mode: 'chat', proposals: [{ ...proposal, state: { kind: 'staged', stage } }] }))
  const fallback = findingFixture({ id: 'other-finding', title: 'Other source', body: '<p>Literal unrelated body.</p>' })
  api.listFindings.mockResolvedValue([fallback])
  await act(async () => { await result.current.loadFindingsForSession('session-1', { force: true, replace: true }) })
  act(() => result.current.askAi.onSelectRecord({ kind: 'finding', recordId: fallback.id, title: fallback.title, unsaved: false }))
  const reference = { sessionId: 'session-1', draftId: 'chat-session-1' }
  await act(async () => { await result.current.askAi.openStage({ reference, proposalId: proposal.id, stageId: stage.id, record: { kind: 'finding', recordId: 'finding-1' } }) })
  expect(result.current.recordChat.chat?.owner).toEqual({ kind: 'notes', sessionId: 'session-1' })
  expect(result.current.askAi.source).toEqual({ kind: 'unavailable' })
  const selected = result.current.askAi.capture('session-1')
  expect(selected.kind).toBe('finding')
  if (selected.kind !== 'finding') throw new Error('Expected the actual visible selection')
  expect(selected.snapshot.recordId).toBe('other-finding')
  act(() => result.current.sessionChat.onSetComposer('Keep this text without capturing the fallback'))
  await act(async () => { await result.current.sessionChat.onSend() })
  expect(result.current.sessionChat.composer).toBe('Keep this text without capturing the fallback')
  expect(result.current.sessionChat.error).toContain('original source')
  expect(result.current.findings[0].body).toBe('<p>Literal unrelated body.</p>')
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.updateFinding).not.toHaveBeenCalled()
})

it('recovery retains both durable legacy stages when the loaded Notes snapshot is older', async () => {
  const { result, proposal, after, base, setChat } = await open()
  const reference = { sessionId: 'session-1', draftId: 'chat-session-1' }
  const origins = ['finding-1', 'missing-source'].map((recordId, index) => ({ reference, proposalId: `legacy-${index}`, stageId: `legacy-stage-${index}`, record: { kind: 'finding' as const, recordId } }))
  api.listChatHistory.mockResolvedValue([{ reference, owner: { kind: 'notes', sessionId: 'session-1' }, createdAt: '', lastActiveAt: '', lastActiveOrder: 10, preview: '', archived: false, submission: null, hasContent: true, lastTurnStatus: 'completed', unresolvedStages: origins }])
  if (proposal.target.kind === 'session') throw new Error('Record proposal required')
  setChat(completedChatFixture({ ...reference, revision: 3, lastActiveOrder: 1, proposals: [{ ...proposal, id: 'legacy-1', target: { ...proposal.target, kind: 'finding', snapshot: { ...proposal.target.snapshot, recordId: 'missing-source' } }, state: { kind: 'staged', stage: { id: 'legacy-stage-1', before: proposal.before, after, storedBaseToken: base.expectedStoredBase } } }] }))
  await act(async () => { await result.current.conversations.bind(reference).refresh() })
  let opening!: Promise<void>
  act(() => { opening = result.current.askAi.onAskAi({ kind: 'finding', recordId: 'finding-1', title: 'Source', unsaved: false }) })
  await act(async () => { await opening })
  expect(result.current.askAi.recovery.map(item => item.origin?.stageId)).toEqual(['legacy-stage-0', 'legacy-stage-1'])
  const missing = result.current.askAi.recovery.find(item => item.origin?.stageId === 'legacy-stage-1')!
  await act(async () => { await result.current.askAi.recover(missing) })
  await waitFor(() => expect(result.current.recordChat.chat?.owner).toEqual({ kind: 'notes', sessionId: 'session-1' }))
  expect(result.current.askAi.panel?.legacyOrigin?.record.recordId).toBe('missing-source')
  expect(result.current.askAi.source).toEqual({ kind: 'unavailable' })
  expect(api.beginRecordChat).not.toHaveBeenCalled()
  expect(api.startChatJob).not.toHaveBeenCalled()
})
