import { act, renderHook, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { ChatState, Draft, Finding, DraftPatch, FindingPatch, RecordWriteGuard, RefinementProposal, RefinementRequest } from '../bindings'
import { draftFixture, findingFixture } from '../test/fixtures'
import { preserveManagedImageNodes, richEditorDocumentFromStoredBody, richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { editorValue, recordWriteGuard, RecordWriteConflict } from './recordWriteGuards'
import { chatFixture } from './useSessionChat.testSupport'
import { getTauriMock, useAppController } from './useAppController.testHarness'

const api = getTauriMock()

export async function open(kind: 'finding' | 'test_cases_draft' = 'finding', additional: Array<Finding | Draft> = [], initial?: Finding | Draft) {
  const record = initial ?? (kind === 'finding' ? findingFixture() : draftFixture())
  const before = editorValue(record)
  const after = { ...before, title: 'Refined title', documentJson: richEditorDocumentToStoredBody(preserveManagedImageNodes(richEditorDocumentFromStoredBody(record), richEditorDocumentFromPlainText('Refined expected result'))).bodyJson }
  const base = await recordWriteGuard(record, kind === 'finding' ? 'findings' : 'drafts')
  const proposal: RefinementProposal = { version: 1, id: 'proposal-1', userMessageId: 'message-1', assistantMessageId: 'message-2', target: { kind, snapshot: { sessionId: record.sessionId, recordId: record.id, title: record.title, documentJson: before.documentJson, metadataJson: record.metadataJson, recordKind: record.kind, origin: 'saved', localFingerprint: 'local', storedBaseToken: base.expectedStoredBase } }, patch: kind === 'finding' ? { kind, title: 'Refined title', bodyMarkdown: 'Refined expected result', metadata: null } : { kind, title: 'Refined title', bodyMarkdown: 'Refined expected result' }, before, after, state: { kind: 'offered' } }
  let chat: ChatState = chatFixture({ draftId: 'chat-session-1', proposals: [proposal] })
  const rows = new Map([[chat.draftId, chat]])
  api.getChat.mockImplementation(() => Promise.resolve(chat))
  api.getConversation.mockImplementation(reference => {
    const row = rows.get(reference.draftId)
    if (!row || row.sessionId !== reference.sessionId) return Promise.reject(new Error('Exact conversation not found'))
    return Promise.resolve(row)
  })
  api.resolveRefinement.mockImplementation((request: RefinementRequest) => {
    const current = rows.get(request.scope.draftId)
    if (!current || current.sessionId !== request.scope.sessionId) return Promise.reject(new Error('Wrong proposal conversation'))
    const subject = current.proposals?.find(item => item.id === request.proposalId)
    if (!subject || subject.target.kind === 'session') return Promise.reject(new Error('Exact proposal not found'))
    const token = subject.target.snapshot.storedBaseToken
    if (!token) return Promise.reject(new Error('Stored base required'))
    const stage = 'stage' in subject.state ? subject.state.stage : { id: subject.id === 'proposal-1' ? 'stage-1' : `stage-${subject.id}`, before: subject.before, after: subject.after, storedBaseToken: token }
    const next: ChatState = { ...current, revision: current.revision + 1, proposals: (current.proposals ?? []).map(item => item.id !== subject.id ? item : { ...subject, state: request.action === 'stage' ? { kind: 'staged', stage } : request.action === 'dismiss' ? { kind: 'dismissed' } : request.action === 'abandon' ? { kind: 'abandoned', stage } : { kind: 'undone', stage } }) }
    rows.set(next.draftId, next)
    if (chat.draftId === next.draftId) chat = next
    return Promise.resolve(next)
  })
  api.listFindings.mockResolvedValue(kind === 'finding' ? [record, ...additional] : [])
  api.listDrafts.mockResolvedValue(kind === 'test_cases_draft' ? [record, ...additional] : [])
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.sessionChat.chat?.proposals?.length).toBe(1))
  // oxlint-disable-next-line typescript/require-await -- Preserve the original async act boundary after moving from the exempt test file.
  await act(async () => { hook.result.current.setActiveView(kind === 'finding' ? 'findings' : 'testware') })
  await waitFor(() => expect(kind === 'finding' ? hook.result.current.findings.length : hook.result.current.testwareDrafts.length).toBe(1 + additional.length))
  act(() => hook.result.current.askAi.onSelectRecord({ kind, recordId: record.id, title: record.title, unsaved: false }))
  return { ...hook, record, proposal, after, base, setConversation: (next: ChatState) => rows.set(next.draftId, next), readConversation: (id: string) => rows.get(id)!, setChat: (next: ChatState) => { chat = next; rows.set(next.draftId, next) } }
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

export async function openExact(kind: 'finding' | 'test_cases_draft', initial?: Finding | Draft) {
  const subject = await open(kind, [], initial)
  const storage = storageOutcome(subject.record, kind)
  const command = kind === 'finding' ? api.updateFinding : api.updateDraft
  command.mockImplementation(async (id: string, patch: FindingPatch | DraftPatch, guard: RecordWriteGuard) => {
    const saved = await storage.write(id, patch, guard)
    for (const [request] of api.resolveRefinement.mock.calls) {
      if (request.action !== 'stage') continue
      const chat = subject.readConversation(request.scope.draftId)
      const proposal = chat.proposals?.find(item => item.id === request.proposalId)
      if (!proposal || proposal.state.kind !== 'staged') continue
      subject.setConversation({ ...chat, revision: chat.revision + 1, proposals: [{ ...proposal, state: { kind: 'saved', stage: proposal.state.stage } }] })
    }
    return saved
  })
  return { ...subject, storage, command }
}
