import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RefinementProposal } from '../bindings'
import { editorValue, recordWriteGuard } from './recordWriteGuards'
import { cleanupControllerTest, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { chatFixture } from './useSessionChat.testSupport'
import { kinds, current, saveCurrent, heldCompensation } from './recordActions.compensationGuards.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it.each(kinds.flatMap(kind => (['ack', 'hash'] as const).map(boundary => ({ kind, boundary }))))('$kind Keep current edits during held $boundary restoration preserves a usable Editor lease', async ({ kind, boundary }) => {
  const { result, record, storage, pending, release, table } = await heldCompensation(kind, boundary)
  const value = editorValue(record)
  const base = await recordWriteGuard(record, table)
  const stage = { id: 'prepared-stage', before: value, after: value, storedBaseToken: base.expectedStoredBase }
  const proposal: RefinementProposal = {
    version: 1, id: 'prepared-proposal', userMessageId: 'user', assistantMessageId: 'assistant',
    target: { kind, snapshot: { sessionId: record.sessionId, recordId: record.id, title: record.title,
      documentJson: value.documentJson, metadataJson: record.metadataJson, recordKind: record.kind,
      origin: 'saved', localFingerprint: 'captured', storedBaseToken: base.expectedStoredBase } },
    patch: kind === 'finding' ? { kind, title: null, bodyMarkdown: 'A', metadata: null } : { kind, title: null, bodyMarkdown: 'A' },
    before: value, after: value, state: { kind: 'staged', stage },
  }
  api.getChat.mockResolvedValue(chatFixture({ draftId: 'chat-session-1', proposals: [proposal] }))
  api.resolveRefinement.mockResolvedValue(chatFixture({ draftId: 'chat-session-1', proposals: [{ ...proposal, state: { kind: 'abandoned', stage } }] }))
  await act(async () => { await result.current.sessionChat.onRefresh?.() })
  expect(result.current.sessionChat.proposalControls?.preparedOnly?.has(proposal.id)).toBe(true)
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(false) })
  await act(async () => { await result.current.sessionChat.proposalControls?.onAction(proposal.id, 'abandon') })
  const error = result.current.error
  await act(async () => { release.resolve(); await pending })
  expect(storage.read().title).toBe('Saved A')
  expect(current(result.current, kind).title).toBe('Retained C')
  expect(result.current.error).toBe(error)
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  expect(storage.read().title).toBe('Retained C')
  expect(storage.read().body).toBe('<p>Body C</p>')
})
