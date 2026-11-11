import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ChatState, RefinementProposal } from '../bindings'
import { richEditorDocumentFromPlainText, richEditorDocumentToPlainText, type RichEditorDocument } from '../editor/editorDocument'
import { completedChatFixture } from './useSessionChat.testSupport'

const resolveRefinement = vi.hoisted(() => vi.fn<(request: import('../bindings').RefinementRequest) => Promise<import('../bindings').ChatState>>())
vi.mock('../tauri', async (importOriginal) => ({ ...await importOriginal<typeof import('../tauri')>(), resolveRefinement }))
const { noteChangedWhileUpdatingReason, useNoteProposalControls } = await import('./useNoteProposalControls')

const doc = (text: string) => JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } })
const proposal: RefinementProposal = {
  version: 1, id: 'p1', userMessageId: 'message-1', assistantMessageId: 'message-2', target: { kind: 'session' },
  patch: { kind: 'note', bodyMarkdown: 'Rewritten' },
  before: { title: 'Session Note', documentJson: doc(''), metadataJson: null, recordKind: 'note' },
  after: { title: 'Session Note', documentJson: doc('Rewritten'), metadataJson: null, recordKind: 'note' },
  state: { kind: 'offered' },
}

function setup(onRefresh: () => Promise<void>, saveNote: () => Promise<boolean> = async () => true, initialBlockedReason?: string) {
  let blockedReason = initialBlockedReason
  const state: { body: RichEditorDocument; chat: ChatState } = { body: richEditorDocumentFromPlainText('Original'), chat: completedChatFixture({ proposals: [proposal] }) }
  const view = renderHook(({ body, chat }) => useNoteProposalControls({ chat, onRefresh, saveNote, blockedReason, noteBody: body,
    setNoteBody: next => { state.body = next; view.rerender({ ...state }) } }), { initialProps: { ...state } })
  const show = (patch: Partial<typeof state>) => { Object.assign(state, patch); view.rerender({ ...state }) }
  const block = (reason: string) => { blockedReason = reason; view.rerender({ ...state }) }
  return { view, show, block, note: () => richEditorDocumentToPlainText(state.body) }
}

it('keeps the applied Note and Undo when only the refresh after Update fails', async () => {
  resolveRefinement.mockResolvedValue(completedChatFixture())
  const { view, note } = setup(vi.fn(async () => { throw new Error('offline') }))
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  expect(note()).toBe('Rewritten')
  expect(view.result.current.errors.p1).toBeUndefined()
  expect(view.result.current.undoable?.has('p1')).toBe(true)
})

it('does not apply when the Session changes while the update is recorded', async () => {
  let resolve!: (chat: ChatState) => void
  resolveRefinement.mockReset().mockReturnValue(new Promise(done => { resolve = done }))
  const { view, show, note } = setup(vi.fn(async () => {}))
  let pending: Promise<void> | undefined
  act(() => { pending = view.result.current.onUpdate?.('p1') })
  await act(async () => { await Promise.resolve() })
  act(() => show({ chat: completedChatFixture({ sessionId: 'session-2', proposals: [] }), body: richEditorDocumentFromPlainText('Other Session') }))
  await act(async () => { resolve(completedChatFixture()); await pending })
  expect(note()).toBe('Other Session')
  expect(view.result.current.errors.p1).toBe(noteChangedWhileUpdatingReason)
  // The recorded update is undone because nothing was applied.
  expect(resolveRefinement).toHaveBeenLastCalledWith(expect.objectContaining({ proposalId: 'p1', action: 'undo' }))
})

it('leaves the Note untouched when the server rejects a stale suggestion or the save fails', async () => {
  resolveRefinement.mockReset().mockRejectedValue(new Error('The note changed after this suggestion was made.'))
  const stale = setup(vi.fn(async () => {}))
  await act(async () => { await stale.view.result.current.onUpdate?.('p1') })
  expect(stale.note()).toBe('Original')
  expect(stale.view.result.current.errors.p1).toMatch(/The note changed/)
  resolveRefinement.mockReset()
  const unsaved = setup(vi.fn(async () => {}), async () => false)
  await act(async () => { await unsaved.view.result.current.onUpdate?.('p1') })
  expect(resolveRefinement).not.toHaveBeenCalled()
  expect(unsaved.note()).toBe('Original')
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
  expect(resolveRefinement.mock.calls.filter(([request]) => request.action === 'stage')).toHaveLength(2)
})

it('does not offer an undone suggestion again once the Note was edited', async () => {
  resolveRefinement.mockReset().mockResolvedValue(completedChatFixture())
  const { view, show } = setup(vi.fn(async () => {}))
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  await act(async () => { await view.result.current.onAction('p1', 'undo') })
  expect(view.result.current.undone?.has('p1')).toBe(true)
  act(() => show({ body: richEditorDocumentFromPlainText('Original, then edited') }))
  expect(view.result.current.undone?.has('p1')).toBe(false)
})

it('does not save or record an update while the Note is read-only', async () => {
  resolveRefinement.mockReset()
  const saveNote = vi.fn(async () => true)
  const { view, note } = setup(vi.fn(async () => {}), saveNote, 'Recover the Session Note before updating it.')
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  expect(saveNote).not.toHaveBeenCalled()
  expect(resolveRefinement).not.toHaveBeenCalled()
  expect(note()).toBe('Original')
  expect(view.result.current.errors.p1).toBe('Recover the Session Note before updating it.')
})

function deferredSave() {
  let finish!: (ok: boolean) => void
  const save = vi.fn(() => new Promise<boolean>(done => { finish = done }))
  return { save, finish: (ok = true) => finish(ok) }
}

it('records the update against the conversation revision left by saving', async () => {
  resolveRefinement.mockReset().mockResolvedValue(completedChatFixture())
  const saving = deferredSave()
  const { view, show } = setup(vi.fn(async () => {}), saving.save)
  let pending: Promise<void> | undefined
  act(() => { pending = view.result.current.onUpdate?.('p1') })
  act(() => show({ chat: completedChatFixture({ revision: 9, proposals: [proposal] }) }))
  await act(async () => { saving.finish(); await pending })
  expect(resolveRefinement).toHaveBeenCalledWith(expect.objectContaining({ scope: expect.objectContaining({ expectedRevision: 9 }) }))
})

it('does not re-apply an undone suggestion over edits saved during Update', async () => {
  resolveRefinement.mockReset().mockResolvedValue(completedChatFixture())
  const saving = deferredSave()
  const { view, show, note } = setup(vi.fn(async () => {}), saving.save)
  let pending: Promise<void> | undefined
  act(() => { pending = view.result.current.onUpdate?.('p1') })
  await act(async () => { saving.finish(); await pending })
  await act(async () => { await view.result.current.onAction('p1', 'undo') })
  act(() => { pending = view.result.current.onUpdate?.('p1') })
  act(() => show({ body: richEditorDocumentFromPlainText('Typed while saving') }))
  await act(async () => { saving.finish(); await pending })
  expect(note()).toBe('Typed while saving')
  expect(resolveRefinement.mock.calls.filter(([request]) => request.action === 'stage')).toHaveLength(1)
  expect(view.result.current.errors.p1).toBe(noteChangedWhileUpdatingReason)
})

it('records Undo on the server so the suggestion is offered again after a reload', async () => {
  resolveRefinement.mockReset().mockResolvedValue(completedChatFixture())
  const { view } = setup(vi.fn(async () => {}))
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  await act(async () => { await view.result.current.onAction('p1', 'undo') })
  expect(resolveRefinement).toHaveBeenLastCalledWith(expect.objectContaining({ proposalId: 'p1', action: 'undo' }))
})

it('re-applies after Undo on the revision Undo returned when the refresh fails', async () => {
  resolveRefinement.mockReset()
    .mockResolvedValueOnce(completedChatFixture({ revision: 4, proposals: [{ ...proposal, state: { kind: 'applied' } }] }))
    .mockResolvedValueOnce(completedChatFixture({ revision: 5, proposals: [proposal] }))
    .mockResolvedValueOnce(completedChatFixture({ revision: 6, proposals: [{ ...proposal, state: { kind: 'applied' } }] }))
  const { view, note } = setup(vi.fn(async () => { throw new Error('offline') }))
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  await act(async () => { await view.result.current.onAction('p1', 'undo') })
  expect(resolveRefinement).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'undo', scope: expect.objectContaining({ expectedRevision: 4 }) }))
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  expect(resolveRefinement).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'stage', scope: expect.objectContaining({ expectedRevision: 5 }) }))
  expect(note()).toBe('Rewritten')
})

it('does not undo while the Note is read-only', async () => {
  resolveRefinement.mockReset().mockResolvedValue(completedChatFixture())
  const { view, block, note } = setup(vi.fn(async () => {}))
  await act(async () => { await view.result.current.onUpdate?.('p1') })
  act(() => block('Recover the Session Note before updating it.'))
  await act(async () => { await view.result.current.onAction('p1', 'undo') })
  expect(note()).toBe('Rewritten')
  expect(resolveRefinement.mock.calls.filter(([request]) => request.action === 'undo')).toHaveLength(0)
  expect(view.result.current.errors.p1).toBe('Recover the Session Note before updating it.')
})
