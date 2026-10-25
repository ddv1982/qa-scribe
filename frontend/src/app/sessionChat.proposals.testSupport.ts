import { act, renderHook, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { ChatState, DraftPatch, FindingPatch, RecordWriteGuard, RefinementProposal, RefinementRequest } from '../bindings'
import { draftFixture, findingFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { editorValue, recordWriteGuard, RecordWriteConflict } from './recordWriteGuards'
import { chatFixture } from './useSessionChat.testSupport'
import { getTauriMock, useAppController } from './useAppController.testHarness'

const api = getTauriMock()

export async function open(kind: 'finding' | 'test_cases_draft' = 'finding') {
  const record = kind === 'finding' ? findingFixture() : draftFixture()
  const before = editorValue(record)
  const after = { ...before, title: 'Refined title', documentJson: richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Refined expected result')).bodyJson }
  const base = await recordWriteGuard(record, kind === 'finding' ? 'findings' : 'drafts')
  const proposal: RefinementProposal = { version: 1, id: 'proposal-1', userMessageId: 'message-1', assistantMessageId: 'message-2', target: { kind, snapshot: { sessionId: record.sessionId, recordId: record.id, title: record.title, documentJson: before.documentJson, metadataJson: record.metadataJson, recordKind: record.kind, origin: 'saved', localFingerprint: 'local', storedBaseToken: base.expectedStoredBase } }, patch: kind === 'finding' ? { kind, title: 'Refined title', bodyMarkdown: 'Refined expected result', metadata: null } : { kind, title: 'Refined title', bodyMarkdown: 'Refined expected result' }, before, after, state: { kind: 'offered' } }
  let chat: ChatState = chatFixture({ draftId: 'chat-session-1', proposals: [proposal] })
  // oxlint-disable-next-line typescript/require-await -- Preserve the original async Chat mock from the exempt test file.
  api.getChat.mockImplementation(async () => chat)
  // oxlint-disable-next-line typescript/require-await -- Preserve the original async refinement mock from the exempt test file.
  api.resolveRefinement.mockImplementation(async (request: RefinementRequest) => {
    const stage = { id: 'stage-1', before, after, storedBaseToken: base.expectedStoredBase }
    chat = { ...chat, revision: chat.revision + 1, proposals: [{ ...proposal, state: request.action === 'stage' ? { kind: 'staged', stage } : request.action === 'dismiss' ? { kind: 'dismissed' } : request.action === 'abandon' ? { kind: 'abandoned', stage } : { kind: 'undone', stage } }] }
    return chat
  })
  api.listFindings.mockResolvedValue(kind === 'finding' ? [record] : [])
  api.listDrafts.mockResolvedValue(kind === 'test_cases_draft' ? [record] : [])
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.sessionChat.chat?.proposals?.length).toBe(1))
  // oxlint-disable-next-line typescript/require-await -- Preserve the original async act boundary after moving from the exempt test file.
  await act(async () => { hook.result.current.setActiveView(kind === 'finding' ? 'findings' : 'testware') })
  await waitFor(() => expect(kind === 'finding' ? hook.result.current.findings.length : hook.result.current.testwareDrafts.length).toBe(1))
  act(() => hook.result.current.askAi.onAskAi({ kind, recordId: record.id, title: record.title, unsaved: false }))
  return { ...hook, record, proposal, after, base, setChat: (next: ChatState) => { chat = next } }
}

export async function saveCurrent(controller: ReturnType<typeof useAppController>, kind: 'finding' | 'test_cases_draft') {
  return kind === 'finding' ? controller.handleSaveFinding(controller.findings[0]) : controller.handleSaveDraft(controller.testwareDrafts[0])
}

export function currentRecord(controller: ReturnType<typeof useAppController>, kind: 'finding' | 'test_cases_draft') {
  return kind === 'finding' ? controller.findings[0] : controller.testwareDrafts[0]
}

export function storageOutcome(record: ReturnType<typeof findingFixture> | ReturnType<typeof draftFixture>, kind: 'finding' | 'test_cases_draft') {
  let persisted = record
  const write = async (_id: string, patch: FindingPatch | DraftPatch, guard: RecordWriteGuard) => {
    const expected = await recordWriteGuard(persisted, kind === 'finding' ? 'findings' : 'drafts')
    if (guard.expectedStoredBase !== expected.expectedStoredBase) throw new RecordWriteConflict(persisted)
    persisted = { ...persisted, title: patch.title ?? persisted.title, body: patch.body ?? persisted.body,
      bodyJson: patch.bodyJson === undefined ? persisted.bodyJson : patch.bodyJson,
      bodyFormat: patch.bodyFormat === undefined ? persisted.bodyFormat : patch.bodyFormat,
      metadataJson: patch.metadataJson === undefined ? persisted.metadataJson : patch.metadataJson }
    return persisted
  }
  return { write, read: () => persisted }
}

export function editTitle(controller: ReturnType<typeof useAppController>, kind: 'finding' | 'test_cases_draft', title: string) {
  const record = currentRecord(controller, kind)
  if (kind === 'finding') controller.updateLocalFinding(record.id, { title })
  else controller.updateLocalDraft(record.id, { title })
}

export function discardCurrent(controller: ReturnType<typeof useAppController>, kind: 'finding' | 'test_cases_draft') {
  if (kind === 'finding') controller.discardLocalFinding(controller.findings[0])
  else controller.discardLocalDraft(controller.testwareDrafts[0])
}
