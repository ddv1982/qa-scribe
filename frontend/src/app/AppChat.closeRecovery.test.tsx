import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppChat } from './AppChat'
import type { ChatComposerRequest } from '../bindings'
import { entryFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { completedChatFixture } from './useSessionChat.testSupport'
import { open as openProposal } from './sessionChat.proposals.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
const target = { kind: 'finding', recordId: 'finding-1', title: 'Checkout returns 500', unsaved: false } as const
const closeMessage = 'Some conversation input could not be saved. Resolve failed saves or images in the affected conversation, then try Close again.'
beforeEach(setupControllerTest)
afterEach(() => { vi.restoreAllMocks(); cleanupControllerTest() })

function chat(c: ReturnType<typeof useAppController>) {
  return <AppChat c={c} modelSelectionControl={null} onConfigureAi={() => {}} />
}

async function openRecord() {
  api.listFindings.mockResolvedValue([findingFixture()])
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.sessionChat.chat?.draftId).toBe('chat-session-1'))
  act(() => hook.result.current.setActiveView('findings'))
  await waitFor(() => expect(hook.result.current.findings).toHaveLength(1))
  act(() => hook.result.current.askAi.onSelectRecord(target))
  await act(async () => { await hook.result.current.askAi.onAskAi(target) })
  return hook
}

async function failCanonicalRead(c: ReturnType<typeof useAppController>) {
  let submitting = completedChatFixture({ draftId: 'another-notes' })
  const get = api.getConversation.getMockImplementation()!
  const openNote = api.openSessionNoteState.getMockImplementation()!
  api.getConversation.mockImplementation(ref => ref.draftId === submitting.draftId ? Promise.resolve(submitting) : get(ref))
  const handle = c.conversations.bind({ sessionId: submitting.sessionId, draftId: submitting.draftId })
  await act(async () => { await handle.refresh() })
  api.submitChat.mockImplementation(async () => {
    const receipt = { draftId: submitting.draftId, noteId: 'entry-1', submittedAt: 'saved' }
    submitting = { ...submitting, revision: 4, submission: receipt }
    api.openSessionNoteState.mockRejectedValue(new Error('Canonical Note read unavailable'))
    return receipt
  })
  await act(async () => { await handle.submit() })
  return () => api.openSessionNoteState.mockImplementation(openNote)
}

it('failed image flush explains Close without replacing the ready composer, images, or recovery controls', async () => {
  const { result } = await openRecord()
  const reference = result.current.askAi.reference!
  const owner = result.current.askAi.panel!.owner
  const handle = result.current.conversations.bind(reference)
  act(() => handle.setComposer('Literal input stays. 雪 4827.'))
  const image = { attachmentId: 'ready-image', filename: 'evidence.png', mimeType: 'image/png', sizeBytes: 10 }
  api.importChatImage.mockResolvedValueOnce({ ...handle.snapshot().chat!, composer: 'Literal input stays. 雪 4827.', revision: 2, composerImages: [image] })
  await act(async () => { await handle.attachImages([new File(['image'], 'evidence.png', { type: 'image/png' })]) })
  const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'too-large.png', { type: 'image/png' })
  await act(async () => { await handle.attachImages([oversized]) })
  const failures = handle.snapshot().imageFailures
  const view = render(chat(result.current))
  const input = screen.getByRole('textbox', { name: 'Message' })
  const close = screen.getByRole('button', { name: 'Close Ask AI' })
  await act(async () => fireEvent.click(close))
  view.rerender(chat(result.current))
  expect(screen.getByText(closeMessage)).toBeVisible()
  expect(screen.getByText(closeMessage)).toHaveAttribute('role', 'alert')
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(input)
  expect(input).toBeEnabled()
  expect(input).toHaveValue('Literal input stays. 雪 4827.')
  expect(result.current.askAi.panel).toMatchObject({ phase: 'ready', open: true, owner, reference })
  expect(handle.snapshot().composerImages).toEqual([image])
  expect(handle.snapshot().imageFailures).toEqual(failures)
  expect(screen.getByRole('button', { name: 'Remove evidence.png' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Retry too-large.png' })).toBeEnabled()
  expect(screen.getByRole('list', { name: 'Failed images' })).toHaveTextContent('too-large.png: Something went wrong: Each image must be 10 MiB or smaller.')
  await act(async () => fireEvent.click(close))
  view.rerender(chat(result.current))
  expect(screen.getByText(closeMessage)).toBeVisible()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove failed too-large.png' })))
  await act(async () => fireEvent.click(close))
  view.rerender(chat(result.current))
  expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument()
  expect(handle.snapshot().composer).toBe('Literal input stays. 雪 4827.')
  expect(handle.snapshot().composerImages).toEqual([image])
  expect(api.beginRecordChat).toHaveBeenCalledOnce()
  expect(api.startChatJob).not.toHaveBeenCalled()
})

it('a retained Notes save failure explains blocked Close locally and a later Close retries successfully', async () => {
  const { result } = await openRecord()
  const reference = result.current.askAi.reference!
  act(() => { result.current.sessionChat.onSetComposer('Retained Notes text.'); result.current.conversations.bind(reference).setComposer('Local question.') })
  const save = api.saveChatComposer.getMockImplementation()!
  api.saveChatComposer.mockImplementation((request: ChatComposerRequest) => {
    if (request.scope.draftId === 'chat-session-1') return Promise.reject(new Error('Other workspace disk unavailable'))
    return save(request)
  })
  const view = render(chat(result.current))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' })))
  view.rerender(chat(result.current))
  const panel = within(screen.getByRole('complementary', { name: 'Ask AI' }))
  expect(panel.getByText(closeMessage)).toBeVisible()
  expect(panel.getByRole('textbox', { name: 'Message' })).toHaveValue('Local question.')
  expect(result.current.recordChat.error).toBeNull()
  expect(result.current.sessionChat.error).toBe('Something went wrong: Other workspace disk unavailable')
  expect(result.current.askAi.reference).toEqual(reference)
  api.saveChatComposer.mockImplementation(save)
  await act(async () => fireEvent.click(panel.getByRole('button', { name: 'Close Ask AI' })))
  view.rerender(chat(result.current))
  expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument()
  expect(result.current.sessionChat.composer).toBe('Retained Notes text.')
  expect(result.current.conversations.bind(reference).snapshot().chat?.composer).toBe('Local question.')
  expect(api.beginRecordChat).toHaveBeenCalledOnce()
  expect(api.startChatJob).not.toHaveBeenCalled()
})

it.each(['newer pending close', 'reopened panel', 'Session'] as const)('a held failed Close cannot affect a later %s action', async action => {
  const { result } = await openRecord()
  const reference = result.current.askAi.reference
  const held = deferred<boolean>()
  const newer = deferred<boolean>()
  const flush = vi.spyOn(result.current.conversations, 'flushInputs').mockReturnValueOnce(held.promise)
  const view = render(chat(result.current))
  let closing!: Promise<void>
  let newerClosing: Promise<void> | undefined
  act(() => { closing = result.current.askAi.close() })
  try {
    if (action === 'newer pending close') {
      flush.mockReturnValueOnce(newer.promise)
      act(() => { newerClosing = result.current.askAi.close() })
    }
    if (action === 'reopened panel') {
      act(() => result.current.askAi.onSelectRecord({ ...target, recordId: 'other-record' }))
      expect(result.current.askAi.visible).toBe(false)
      act(() => result.current.askAi.onSelectRecord(target))
      await act(async () => { await result.current.askAi.onAskAi(target) })
      act(() => result.current.conversations.bind(result.current.askAi.reference!).setComposer('New panel input.'))
      expect(result.current.askAi.reference).not.toEqual(reference)
    }
    if (action === 'Session') {
      api.openSessionNoteState.mockResolvedValue(sessionNoteStateFixture({ session: sessionFixture({ id: 'session-2' }), noteEntry: entryFixture({ sessionId: 'session-2' }) }))
      await act(async () => { await result.current.openSession(sessionFixture({ id: 'session-2', title: 'Second Session' })) })
    }
    const panel = result.current.askAi.panel
    await act(async () => { held.resolve(false); await closing })
    view.rerender(chat(result.current))
    expect(result.current.askAi.panel).toBe(panel)
    expect(result.current.askAi.visible).toBe(action !== 'Session')
    expect(screen.queryByText(closeMessage)).not.toBeInTheDocument()
    if (action === 'reopened panel') expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('New panel input.')
    if (action === 'newer pending close') {
      await act(async () => { newer.resolve(true); await newerClosing })
      view.rerender(chat(result.current))
    }
    if (action !== 'reopened panel') expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument()
    if (action === 'Session') expect(result.current.activeSession?.id).toBe('session-2')
    expect(api.beginRecordChat).toHaveBeenCalledTimes(action === 'reopened panel' ? 2 : 1)
    expect(api.startChatJob).not.toHaveBeenCalled()
  } finally {
    await act(async () => { held.resolve(false); newer.resolve(true); await closing; await newerClosing })
    flush.mockRestore()
  }
})

it('legacy Notes reflects real canonical Note recovery until it clears and keeps the exact binding', async () => {
  const { result, proposal, after, base, setChat } = await openProposal()
  const reference = { sessionId: 'session-1', draftId: 'chat-session-1' }
  const stage = { id: 'legacy-stage', before: proposal.before, after, storedBaseToken: base.expectedStoredBase }
  setChat(completedChatFixture({ ...reference, proposals: [{ ...proposal, state: { kind: 'staged', stage } }] }))
  api.listFindings.mockResolvedValue([])
  await act(async () => { await result.current.loadFindingsForSession('session-1', { force: true, replace: true }) })
  act(() => result.current.askAi.onSelectRecord(null))
  await act(async () => { await result.current.askAi.openStage({ reference, proposalId: proposal.id, stageId: stage.id, record: target }) })
  const view = render(chat(result.current))
  const panel = within(screen.getByRole('complementary', { name: 'Ask AI' }))
  const input = panel.getByRole('textbox', { name: 'Message' })
  expect(input).toBeEnabled()
  expect(panel.getByRole('button', { name: 'Attach images' })).toBeEnabled()
  expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled()
  const allowRecovery = await failCanonicalRead(result.current)
  expect(result.current.noteReadOnly).toBe(true)
  view.rerender(chat(result.current))
  expect(input).toBeDisabled()
  expect(panel.getByRole('button', { name: 'Attach images' })).toBeDisabled()
  expect(panel.getByRole('button', { name: 'Recover Session Note' })).toBeEnabled()
  expect(panel.getByText('Session Note recovery required')).toBeVisible()
  expect(result.current.askAi.reference).toEqual(reference)
  expect(result.current.recordChat.chat?.owner).toEqual({ kind: 'notes', sessionId: 'session-1' })
  await act(async () => { result.current.conversations.bind(reference).setComposer('Rejected during recovery') })
  expect(result.current.recordChat.composer).toBe('')
  allowRecovery()
  await act(async () => fireEvent.click(panel.getByRole('button', { name: 'Recover Session Note' })))
  view.rerender(chat(result.current))
  expect(result.current.noteReadOnly).toBe(false)
  expect(input).toBeEnabled()
  expect(panel.getByRole('button', { name: 'Attach images' })).toBeEnabled()
  expect(panel.queryByRole('button', { name: 'Recover Session Note' })).not.toBeInTheDocument()
  await act(async () => fireEvent.change(input, { target: { value: 'Editable after recovery. 雪' } }))
  view.rerender(chat(result.current))
  expect(input).toHaveValue('Editable after recovery. 雪')
  expect(result.current.conversations.bind(reference).snapshot().composer).toBe('Editable after recovery. 雪')
  expect(result.current.askAi.source).toEqual({ kind: 'unavailable' })
  expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled()
  expect(api.submitChat).toHaveBeenCalledOnce()
  expect(api.beginRecordChat).not.toHaveBeenCalled()
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.updateFinding).not.toHaveBeenCalled()
})

it('canonical Note recovery leaves ordinary record composer and attachments editable', async () => {
  const { result } = await openRecord()
  await failCanonicalRead(result.current)
  expect(result.current.noteReadOnly).toBe(true)
  render(chat(result.current))
  const panel = within(screen.getByRole('complementary', { name: 'Ask AI' }))
  expect(panel.getByRole('textbox', { name: 'Message' })).toBeEnabled()
  expect(panel.getByRole('button', { name: 'Attach images' })).toBeEnabled()
  expect(panel.queryByRole('button', { name: 'Recover Session Note' })).not.toBeInTheDocument()
  await act(async () => fireEvent.change(panel.getByRole('textbox', { name: 'Message' }), { target: { value: 'Independent record input' } }))
  expect(result.current.recordChat.composer).toBe('Independent record input')
  expect(api.startChatJob).not.toHaveBeenCalled()
})
