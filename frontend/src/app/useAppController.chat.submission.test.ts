import { act, renderHook, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { richTextEditorExtensions } from '../editor/editorExtensions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture } from '../test/fixtures'
import {
  richEditorDocumentFromPlainText, richEditorDocumentToPlainText, richEditorDocumentToStoredBody, richEditorDocumentFromStoredBody,
} from '../editor/editorDocument'
import { completedChatFixture } from './useSessionChat.testSupport'
import {
  cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture,
  setupControllerTest, useAppController,
} from './useAppController.testHarness'

const api = getTauriMock()
const receipt = { draftId: 'chat-1', noteId: 'entry-1', submittedAt: '2026-10-14T10:00:00Z' }

describe('Session Chat explicit canonical Note handoff', () => {
  beforeEach(() => {
    setupControllerTest()
    api.getChat.mockResolvedValue(completedChatFixture())
    api.submitChat.mockResolvedValue(receipt)
  })
  afterEach(cleanupControllerTest)

  it('does not autosave adopted canonical JSON when TipTap emits the same content with editor key order', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const stored = richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Existing Note\nAssistant: Which build?'))
    const canonical = entryFixture({ ...stored, bodyJson: JSON.stringify(JSON.parse(stored.bodyJson), (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value) })
    api.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture())
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: canonical }))
    api.getChat.mockResolvedValue(completedChatFixture({ submission: receipt, mode: 'write_note', revision: 4 }))
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(result.current.noteEntry).toEqual(canonical)
    const editor = new Editor({ extensions: richTextEditorExtensions(), content: richEditorDocumentFromStoredBody(canonical).doc })
    try {
      act(() => result.current.setNoteBody({ schemaVersion: 1, doc: editor.getJSON() }))
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(api.updateEntry).not.toHaveBeenCalled()
      expect(result.current.sessionSaveState).toBe('saved')
      expect(result.current.noteEntry).toEqual(canonical)
      editor.commands.insertContent('Tester edit')
      act(() => result.current.setNoteBody({ schemaVersion: 1, doc: editor.getJSON() }))
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(api.updateEntry).toHaveBeenCalledTimes(1)
      expect(result.current.noteEntry?.body).toContain('Tester edit')
    } finally { editor.destroy() }
  })

  it('flushes Note edits, submits all canonical representations, adopts the updated Note and clears summary undo', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
    const authored = richEditorDocumentFromPlainText('Authored tester context')
    const stored = richEditorDocumentToStoredBody(authored)
    act(() => {
      result.current.setNoteBody(authored)
      result.current.setLatestNoteGenerationUndo({ kind: 'undo', entryId: 'entry-1', before: authored })
    })
    const canonical = entryFixture(richEditorDocumentToStoredBody(
      richEditorDocumentFromPlainText('Authored tester context\nUser: Payment failed\nAssistant: Which build?'),
    ))
    api.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture(stored) }))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: canonical }))
    api.getChat.mockResolvedValue(completedChatFixture({ submission: receipt, mode: 'write_note', revision: 4 }))
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(api.updateEntry).toHaveBeenCalledWith('entry-1', expect.objectContaining(stored))
    expect(api.submitChat).toHaveBeenCalledWith({
      scope: { sessionId: 'session-1', draftId: 'chat-1', expectedRevision: 3 },
      noteId: 'entry-1', expectedNoteBody: stored.body,
      expectedNoteBodyJson: stored.bodyJson, expectedNoteBodyFormat: stored.bodyFormat,
    })
    expect(api.updateEntry.mock.invocationCallOrder[0]).toBeLessThan(api.submitChat.mock.invocationCallOrder[0])
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toContain('Assistant: Which build?')
    expect(result.current.noteEntry).toEqual(canonical)
    expect(result.current.latestNoteGenerationUndo).toBeNull()
    expect(result.current.sessionMode).toBe('write_note')
    expect(result.current.sessionSaveState).toBe('saved')
    expect(api.startAiActionJob).not.toHaveBeenCalled()
    expect(api.startChatJob).not.toHaveBeenCalled()
  })

  it('keeps accepted review available during a local mode-only change', async () => {
    api.getChat.mockResolvedValue(completedChatFixture({ mode: 'write_note' }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
    act(() => result.current.setSessionMode('chat'))
    expect(result.current.sessionChat.dirty).toBe(true)
    expect(result.current.sessionChat.composer).toBe('')
    expect(result.current.sessionChat.handoff).toEqual({ kind: 'conversation', disabled: false, reason: '', hydrationPending: false, reviewAvailable: true })
    expect(api.submitChat).not.toHaveBeenCalled()
    expect(api.startChatJob).not.toHaveBeenCalled()
  })

  it('drains already in-flight Note writes before submission and prevents stale ambient autosave afterwards', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const authored = richEditorDocumentFromPlainText('Pending authored body')
    act(() => result.current.setNoteBody(authored))
    const write = deferred<ReturnType<typeof entryFixture>>()
    api.updateEntry.mockReturnValueOnce(write.promise)
    let save!: Promise<boolean>
    act(() => { save = result.current.saveNoteNow() })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(api.updateEntry).toHaveBeenCalledTimes(1)
    const canonical = entryFixture(richEditorDocumentToStoredBody(
      richEditorDocumentFromPlainText('Pending authored body\nAssistant: Which build?'),
    ))
    api.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture(richEditorDocumentToStoredBody(authored)) }))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: canonical }))
    api.getChat.mockResolvedValue(completedChatFixture({ submission: receipt, revision: 4, mode: 'write_note' }))
    let submit!: Promise<void>
    act(() => { submit = result.current.sessionChat.onSubmit() })
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(api.submitChat).not.toHaveBeenCalled()
    await act(async () => {
      write.resolve(entryFixture(richEditorDocumentToStoredBody(authored)))
      await save
      await submit
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(api.submitChat).toHaveBeenCalledTimes(1)
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toContain('Assistant: Which build?')
    expect(result.current.sessionSaveState).toBe('saved')
    const submitOrder = api.submitChat.mock.invocationCallOrder[0]
    expect(api.updateEntry.mock.invocationCallOrder.every((order) => order < submitOrder)).toBe(true)
  })

  it('does not submit after a failed Note flush and preserves authored edits for retry', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Must not lose this')))
    api.updateEntry.mockRejectedValue(new Error('Note save failed'))
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(api.submitChat).not.toHaveBeenCalled()
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Must not lose this')
    expect(result.current.sessionMode).toBe('chat')
    expect(result.current.sessionSaveState).toBe('unsaved')
  })

  it('leaves chat and Note intact on a canonical Note conflict', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
    api.submitChat.mockRejectedValue(new Error('Note changed since capture'))
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(result.current.sessionChat.error).toContain('Note changed since capture')
    expect(result.current.sessionChat.chat?.submission).toBeNull()
    expect(result.current.sessionMode).toBe('chat')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toContain('Checkout fails after payment')
    expect(api.updateEntry).not.toHaveBeenCalled()
  })

  it('rejects submission of a conversation with any unresolved turn', async () => {
    const unresolved = completedChatFixture()
    unresolved.messages[1].status = 'interrupted'
    api.getChat.mockResolvedValue(unresolved)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(api.submitChat).not.toHaveBeenCalled()
    expect(api.updateEntry).not.toHaveBeenCalled()
    expect(result.current.sessionMode).toBe('chat')
    expect(result.current.sessionChat.error).toBeTruthy()
  })

  it('rejects submission with nonempty composer rather than silently clearing unsent input', async () => {
    api.getChat.mockResolvedValue(completedChatFixture({ composer: 'Unsent follow-up' }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composer).toBe('Unsent follow-up'))
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(api.submitChat).not.toHaveBeenCalled()
    expect(result.current.sessionChat.composer).toBe('Unsent follow-up')
    expect(result.current.sessionChat.error).toContain('composer')
  })
})
