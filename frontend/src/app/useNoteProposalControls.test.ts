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

it('shows Note updated with Undo, not Update note, when the refresh after Update fails', async () => {
  const { render, screen } = await import('@testing-library/react')
  const { ChatProposalReview } = await import('../views/ChatProposalReview')
  resolveRefinement.mockResolvedValue(completedChatFixture())
  const { view } = setup(vi.fn(async () => { throw new Error('offline') }))
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  const { createElement } = await import('react')
  render(createElement(ChatProposalReview, { proposal, controls: view.result.current }))
  expect(screen.getByText('Note updated')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Update note' })).toBeNull()
})

it('offers the suggestion again after Undo and can apply it a second time', async () => {
  const { render, within } = await import('@testing-library/react')
  const { createElement } = await import('react')
  const { ChatProposalReview } = await import('../views/ChatProposalReview')
  resolveRefinement.mockReset().mockResolvedValue(completedChatFixture())
  const { view, note } = setup(vi.fn(async () => {}))
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  await act(async () => { await view.result.current.onAction('p1', 'undo') })
  expect(note()).toBe('Original')
  const applied = { ...proposal, state: { kind: 'applied' as const } }
  const card = render(createElement(ChatProposalReview, { proposal: applied, controls: view.result.current }))
  expect(within(card.container).queryByText('Note updated')).toBeNull()
  expect(within(card.container).getByRole('button', { name: 'Update note' })).toBeTruthy()
  card.unmount()
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  expect(note()).toBe('Rewritten')
  expect(resolveRefinement).toHaveBeenCalledTimes(2)
})
