import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AppliedNoteRefinement, ApplyNoteRefinementRequest, Entry, RefinementProposal } from '../bindings'
import { richEditorDocumentFromPlainText, serializeRichEditorDocument } from '../editor/editorDocument'
import { completedChatFixture } from './useSessionChat.testSupport'

const applyNote = vi.hoisted(() => vi.fn<(request: ApplyNoteRefinementRequest) => Promise<AppliedNoteRefinement>>())
vi.mock('../tauri', async importOriginal => {
  const api = await importOriginal<typeof import('../tauri')>()
  return { ...api, applyNoteRefinement: applyNote }
})
const { useNoteProposalControls } = await import('./useNoteProposalControls')
const noteBody = richEditorDocumentFromPlainText('Original')
const value = { title: 'Note', documentJson: serializeRichEditorDocument(noteBody), metadataJson: null, recordKind: 'note' }
const proposal: RefinementProposal = {
  version: 1, id: 'p1', userMessageId: 'message-1', assistantMessageId: 'message-2', target: { kind: 'session' },
  patch: { kind: 'note', bodyMarkdown: 'Rewritten' }, before: value, after: value, state: { kind: 'offered' },
}
const chat = completedChatFixture({ revision: 1, proposals: [proposal] })
const note = { id: 'note', sessionId: chat.sessionId, body: '<p>Rewritten</p>' } as Entry

function setup({ saveNote = async () => true, blockedReason }: { saveNote?: () => Promise<boolean>; blockedReason?: string } = {}) {
  const adoptNote = vi.fn()
  const onRefresh = vi.fn(async () => { throw new Error('offline') })
  const view = renderHook(() => useNoteProposalControls({ chat, onRefresh, saveNote, blockedReason, noteBody, adoptNote }))
  return { view, adoptNote, onRefresh }
}
beforeEach(() => { applyNote.mockReset() })

it('uses the durable update result and offers Undo even if refresh fails', async () => {
  applyNote.mockResolvedValueOnce({ note, chat: { ...chat, revision: 2, proposals: [{ ...proposal, state: { kind: 'note_applied' } }] } })
  const { view, adoptNote } = setup()
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  expect(adoptNote).toHaveBeenCalledWith(note, serializeRichEditorDocument(noteBody))
  expect(view.result.current.undoable?.has('p1')).toBe(true)
  applyNote.mockResolvedValueOnce({ note: { ...note, body: '<p>Original</p>' }, chat: { ...chat, revision: 3 } })
  await act(async () => { await view.result.current.onAction('p1', 'undo') })
  expect(applyNote).toHaveBeenLastCalledWith({ reference: { sessionId: chat.sessionId, draftId: chat.draftId }, proposalId: 'p1', undo: true })
  expect(view.result.current.undone?.has('p1')).toBe(true)
})

it('reports a rejected update without replacing the editor', async () => {
  applyNote.mockRejectedValue(new Error('The Note changed'))
  const { view, adoptNote } = setup()
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  expect(adoptNote).not.toHaveBeenCalled()
  expect(view.result.current.errors.p1).toContain('The Note changed')
})

it.each([false, true])('keeps the suggestion offered when saving is blocked or fails', async blocked => {
  const saveNote = vi.fn(async () => false)
  const { view, adoptNote } = setup({ saveNote, blockedReason: blocked ? 'Recover the Note' : undefined })
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  expect(saveNote).toHaveBeenCalledTimes(blocked ? 0 : 1)
  expect(applyNote).not.toHaveBeenCalled()
  expect(adoptNote).not.toHaveBeenCalled()
})
