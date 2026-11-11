import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ChatState, RefinementProposal } from '../bindings'
import { richEditorDocumentFromPlainText, richEditorDocumentToPlainText, type RichEditorDocument } from '../editor/editorDocument'
import { completedChatFixture } from './useSessionChat.testSupport'

const resolveRefinement = vi.hoisted(() => vi.fn())
vi.mock('../tauri', async (importOriginal) => ({ ...await importOriginal<typeof import('../tauri')>(), resolveRefinement }))
const { useNoteProposalControls } = await import('./useNoteProposalControls')

const doc = (text: string) => JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } })
const proposal: RefinementProposal = {
  version: 1, id: 'p1', userMessageId: 'message-1', assistantMessageId: 'message-2', target: { kind: 'session' },
  patch: { kind: 'note', bodyMarkdown: 'Rewritten' },
  before: { title: 'Session Note', documentJson: doc(''), metadataJson: null, recordKind: 'note' },
  after: { title: 'Session Note', documentJson: doc('Rewritten'), metadataJson: null, recordKind: 'note' },
  state: { kind: 'offered' },
}

function setup(onRefresh: () => Promise<void>) {
  const state: { body: RichEditorDocument; chat: ChatState } = { body: richEditorDocumentFromPlainText('Original'), chat: completedChatFixture({ proposals: [proposal] }) }
  const view = renderHook(({ body, chat }) => useNoteProposalControls({ chat, onRefresh, noteBody: body,
    setNoteBody: next => { state.body = next; view.rerender({ ...state }) } }), { initialProps: { ...state } })
  const show = (patch: Partial<typeof state>) => { Object.assign(state, patch); view.rerender({ ...state }) }
  return { view, show, note: () => richEditorDocumentToPlainText(state.body) }
}

it('keeps the applied Note and Undo when only the refresh after Update fails', async () => {
  resolveRefinement.mockResolvedValue(completedChatFixture())
  const { view, note } = setup(vi.fn(async () => { throw new Error('offline') }))
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  expect(note()).toBe('Rewritten')
  expect(view.result.current.errors.p1).toBeUndefined()
  expect(view.result.current.undoable?.has('p1')).toBe(true)
})

it('does not roll back into another Session when Update cannot be recorded', async () => {
  let reject!: (error: Error) => void
  resolveRefinement.mockReturnValue(new Promise((_, fail) => { reject = fail }))
  const { view, show, note } = setup(vi.fn(async () => {}))
  let pending: Promise<void> | undefined
  act(() => { pending = view.result.current.onUpdate?.('p1') })
  expect(note()).toBe('Rewritten')
  // Another Session opens whose Note happens to read the same.
  act(() => show({ chat: completedChatFixture({ sessionId: 'session-2', proposals: [] }), body: richEditorDocumentFromPlainText('Rewritten') }))
  await act(async () => { reject(new Error('Chat changed')); await pending })
  expect(note()).toBe('Rewritten')
  expect(view.result.current.errors.p1).toBe('Chat changed')
})
