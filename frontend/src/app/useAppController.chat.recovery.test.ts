import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSubmissionReceipt, EntryPatch } from '../bindings'
import { entryFixture, generationStatusFixture } from '../test/fixtures'
import {
  richEditorDocumentFromHtml, richEditorDocumentFromPlainText,
  richEditorDocumentToHtml, richEditorDocumentToPlainText, richEditorDocumentToStoredBody,
} from '../editor/editorDocument'
import { completedChatFixture } from './useSessionChat.testSupport'
import {
  cleanupControllerTest, deferred, getTauriMock, getTauriWindowMock,
  sessionNoteStateFixture, setupControllerTest, useAppController,
} from './useAppController.testHarness'

const api = getTauriMock()
const desktop = getTauriWindowMock()
const receipt: ChatSubmissionReceipt = {
  draftId: 'chat-1', noteId: 'entry-1', submittedAt: '2026-10-14T10:00:00Z',
}
const authoredHtml = '<p><strong>Authored context</strong> <em>must stay</em></p>'
  + '<img data-attachment-id="evidence-1" src="qa-scribe-attachment://evidence-1" alt="Evidence">'
const transcriptHtml = '<h2>Session Chat</h2><p>User: Payment failed</p><p>Assistant: Which build?</p>'

// Model the durable transaction separately from the subsequent failing read.
// updateEntry mutates the durable Note, so an unsafe stale save is observable.
function durableSubmission(response?: Promise<ChatSubmissionReceipt> | (() => Promise<ChatSubmissionReceipt>)) {
  const original = entryFixture(richEditorDocumentToStoredBody(richEditorDocumentFromHtml(authoredHtml)))
  const canonical = entryFixture(richEditorDocumentToStoredBody(richEditorDocumentFromHtml(authoredHtml + transcriptHtml)))
  let note = original
  let chat = completedChatFixture()
  let committed = false
  let recoveryReadFails = true
  api.openSessionNoteState.mockReset().mockImplementation(async () => {
    if (committed && recoveryReadFails) throw new Error('Canonical Note read unavailable')
    return sessionNoteStateFixture({ noteEntry: note })
  })
  api.getChat.mockReset().mockImplementation(async () => chat)
  api.submitChat.mockReset().mockImplementation(async () => {
    if (committed) throw new Error('A second backend submit must not be necessary')
    committed = true
    note = canonical
    chat = completedChatFixture({ revision: 4, mode: 'write_note', submission: receipt })
    return typeof response === 'function' ? response() : response ?? receipt
  })
  api.updateEntry.mockReset().mockImplementation(async (_id: string, patch: EntryPatch) => {
    note = { ...note, ...patch }
    return note
  })
  return { original, canonical, durableNote: () => note, allowRecoveryRead: () => { recoveryReadFails = false } }
}

async function failedHandoff(result: { current: ReturnType<typeof useAppController> }) {
  await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
  await act(async () => { await result.current.sessionChat.onSubmit() })
  expect(api.submitChat).toHaveBeenCalledTimes(1)
  expect(result.current.sessionChat.chat?.submission).toEqual(receipt)
  expect(result.current.sessionChat.error).toContain('updated Note could not be loaded')
}

describe('BlockingR37-01: pending canonical Note recovery after durable Chat submission', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('keeps Chat recovery authoritative when a recovered Summary completes during uncertain submission', async () => {
    const model = durableSubmission()
    const status = deferred<ReturnType<typeof generationStatusFixture>>()
    api.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'summary-intersection', action: 'summary', state: 'running' }),
    ])
    api.getAiActionJobStatus.mockReturnValue(status.promise)
    const { result } = renderHook(() => useAppController())
    await failedHandoff(result)
    api.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({
      noteEntry: entryFixture({ body: '<p>Concurrent Summary must not replace Chat recovery</p>' }),
    }))
    await act(async () => {
      status.resolve(generationStatusFixture({ jobId: 'summary-intersection', action: 'summary', state: 'completed' }))
      await status.promise
    })
    await waitFor(() => expect(result.current.notice).toBe('Generation finished'), { timeout: 2500 })
    expect(result.current.noteReadOnly).toBe(true)
    expect(richEditorDocumentToPlainText(result.current.noteBody)).not.toContain('Concurrent Summary')
    await act(async () => {
      expect(await result.current.saveBody(richEditorDocumentFromPlainText('Unsafe recovery write'), { allowRecoveryWrite: true })).toBe(false)
    })
    expect(api.updateEntry).not.toHaveBeenCalled()
    expect(model.durableNote()).toEqual(model.canonical)
    model.allowRecoveryRead()
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(result.current.noteEntry).toEqual(model.canonical)
    expect(result.current.noteReadOnly).toBe(false)
    expect(api.submitChat).toHaveBeenCalledTimes(1)
  })

  it('serializes active Session recovery behind the original handoff so a late read cannot replace newer edits', async () => {
    const model = durableSubmission()
    model.allowRecoveryRead()
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
    const postSubmit = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    api.openSessionNoteState.mockImplementation(async () => {
      if (api.submitChat.mock.calls.length > 0) return postSubmit.promise
      return sessionNoteStateFixture({ noteEntry: model.original })
    })
    let submission!: Promise<void>
    act(() => { submission = result.current.sessionChat.onSubmit() })
    await waitFor(() => expect(api.submitChat).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.openSessionNoteState).toHaveBeenCalledTimes(3))
    const reads = api.openSessionNoteState.mock.calls.length
    api.openSessionNoteState.mockResolvedValue(sessionNoteStateFixture({ noteEntry: model.canonical }))
    let reopen!: Promise<void>
    await act(async () => {
      reopen = result.current.openSessionInCurrentView(result.current.activeSession!)
      await Promise.resolve()
    })
    expect(api.openSessionNoteState).toHaveBeenCalledTimes(reads)
    expect(result.current.noteReadOnly).toBe(true)
    await act(async () => {
      postSubmit.resolve(sessionNoteStateFixture({ noteEntry: model.canonical }))
      await submission
      await reopen
    })
    expect(result.current.noteReadOnly).toBe(false)
    const newer = richEditorDocumentFromHtml(model.canonical.body + '<p>Newer tester edit</p>')
    act(() => result.current.setNoteBody(newer))
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toContain('Newer tester edit')
    await act(async () => { expect(await result.current.saveNoteNow()).toBe(true) })
    expect(model.durableNote().body).toContain('Newer tester edit')
    expect(model.durableNote().body.match(/User: Payment failed/g)).toHaveLength(1)
    expect(model.durableNote().body).toContain('evidence-1')
    expect(api.submitChat).toHaveBeenCalledTimes(1)
    expect(api.startAiActionJob).not.toHaveBeenCalled()
  })

  it('blocks edits, direct writes and ambient autosave after mode switching while canonical recovery fails', async () => {
    const model = durableSubmission()
    const { result } = renderHook(() => useAppController())
    await failedHandoff(result)
    vi.useFakeTimers()
    const unsafe = richEditorDocumentFromPlainText('Stale visible body must not replace the submitted Note')
    act(() => {
      result.current.setSessionMode('write_note')
      result.current.setNoteBody(unsafe)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => {
      expect(await result.current.saveNoteNow()).toBe(false)
      expect(await result.current.saveBody(unsafe)).toBe(false)
      // Summary's existing recovery override must not bypass this separate guard.
      expect(await result.current.saveBody(unsafe, { allowRecoveryWrite: true })).toBe(false)
    })
    expect(api.updateEntry).not.toHaveBeenCalled()
    expect(model.durableNote()).toEqual(model.canonical)
    expect(richEditorDocumentToHtml(result.current.noteBody)).not.toContain('Stale visible body')
    expect(result.current.noteReadOnly).toBe(true)
  })

  it('keeps native close and the coordinated flush blocked until canonical adoption succeeds', async () => {
    durableSubmission()
    const { result } = renderHook(() => useAppController())
    await failedHandoff(result)
    await waitFor(() => expect(desktop.closeRequestedHandler()).toBeTruthy())
    const failedReadCount = api.openSessionNoteState.mock.calls.length
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(api.openSessionNoteState.mock.calls.length).toBeGreaterThan(failedReadCount)
    const event = { preventDefault: vi.fn() }
    await act(async () => { await desktop.closeRequestedHandler()?.(event) })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(desktop.currentWindow.destroy).not.toHaveBeenCalled()
    await act(async () => { expect(await result.current.saveAllPendingChanges()).toBe(false) })
    expect(api.submitChat).toHaveBeenCalledTimes(1)
    expect(api.updateEntry).not.toHaveBeenCalled()
  })

  it('recovers rich canonical content through explicit submit retry without another backend submit', async () => {
    const model = durableSubmission()
    const { result } = renderHook(() => useAppController())
    await failedHandoff(result)
    model.allowRecoveryRead()
    const gate = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    const reads = api.openSessionNoteState.mock.calls.length
    api.openSessionNoteState.mockReturnValueOnce(gate.promise)
    let retry!: Promise<void>
    act(() => { retry = result.current.sessionChat.onSubmit() })
    await waitFor(() => expect(api.openSessionNoteState).toHaveBeenCalledTimes(reads + 1))
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(api.submitChat).toHaveBeenCalledTimes(1)
    await act(async () => {
      gate.resolve(sessionNoteStateFixture({ noteEntry: model.canonical }))
      await retry
    })
    expect(result.current.noteEntry).toEqual(model.canonical)
    const html = richEditorDocumentToHtml(result.current.noteBody)
    expect(html).toContain('<strong>Authored context</strong>')
    expect(html).toContain('<em>must stay</em>')
    expect(html).toContain('evidence-1')
    expect(richEditorDocumentToPlainText(result.current.noteBody).match(/User: Payment failed/g)).toHaveLength(1)
    expect(model.durableNote()).toEqual(model.canonical)
    expect(result.current.noteReadOnly).toBe(false)
    expect(result.current.sessionMode).toBe('write_note')
    expect(result.current.sessionSaveState).toBe('saved')
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(api.submitChat).toHaveBeenCalledTimes(1)
    expect(api.updateEntry).not.toHaveBeenCalled()
    act(() => result.current.setNoteBody(richEditorDocumentFromHtml(html + '<p>After recovery tester addition</p>')))
    await act(async () => { expect(await result.current.saveNoteNow()).toBe(true) })
    const durableHtml = model.durableNote().body
    expect(durableHtml).toContain('<strong>Authored context</strong>')
    expect(durableHtml).toContain('evidence-1')
    expect(durableHtml).toContain('After recovery tester addition')
    expect(durableHtml.match(/User: Payment failed/g)).toHaveLength(1)
    expect(api.updateEntry).toHaveBeenCalledTimes(1)
  })

  it('adopts canonical recovery on reopening the active Session instead of saving its stale visible Note', async () => {
    const model = durableSubmission()
    const { result } = renderHook(() => useAppController())
    await failedHandoff(result)
    model.allowRecoveryRead()
    await act(async () => { await result.current.openSession(result.current.activeSession!) })
    expect(result.current.noteEntry).toEqual(model.canonical)
    expect(richEditorDocumentToPlainText(result.current.noteBody).match(/User: Payment failed/g)).toHaveLength(1)
    expect(result.current.noteReadOnly).toBe(false)
    expect(api.submitChat).toHaveBeenCalledTimes(1)
    expect(api.updateEntry).not.toHaveBeenCalled()
  })

  it('blocks Note writes before a committed submit invocation delivers its delayed acknowledgement', async () => {
    const acknowledgement = deferred<ChatSubmissionReceipt>()
    const model = durableSubmission(acknowledgement.promise)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
    let submission!: Promise<void>
    act(() => { submission = result.current.sessionChat.onSubmit() })
    await waitFor(() => expect(api.submitChat).toHaveBeenCalledTimes(1))
    const unsafe = richEditorDocumentFromPlainText('An edit during the committed invoke')
    let saved = true
    try {
      act(() => result.current.setNoteBody(unsafe))
      await act(async () => {
        saved = await result.current.saveBody(unsafe, { allowRecoveryWrite: true })
        await result.current.sessionChat.onSubmit()
      })
    } finally {
      await act(async () => { acknowledgement.resolve(receipt); await submission })
    }
    expect(saved).toBe(false)
    expect(api.updateEntry).not.toHaveBeenCalled()
    expect(model.durableNote()).toEqual(model.canonical)
    expect(api.submitChat).toHaveBeenCalledTimes(1)
    expect(result.current.noteReadOnly).toBe(true)
  })

  it('allows native close after explicit canonical recovery without rewriting the transcript', async () => {
    const model = durableSubmission()
    const { result } = renderHook(() => useAppController())
    await failedHandoff(result)
    model.allowRecoveryRead()
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(result.current.noteEntry).toEqual(model.canonical)
    await act(async () => { expect(await result.current.saveAllPendingChanges()).toBe(true) })
    const event = new Event('beforeunload', { cancelable: true })
    act(() => { window.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
    expect(api.updateEntry).not.toHaveBeenCalled()
    expect(api.submitChat).toHaveBeenCalledTimes(1)
  })

  it('keeps an ambiguous invocation failure guarded and recovers a durable commit without resubmitting', async () => {
    const model = durableSubmission(async () => { throw new Error('Invoke acknowledgement lost') })
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(result.current.sessionChat.error).toContain('Invoke acknowledgement lost')
    expect(result.current.noteReadOnly).toBe(true)
    expect(model.durableNote()).toEqual(model.canonical)
    const unsafe = richEditorDocumentFromPlainText('Unknown outcome must not permit a stale overwrite')
    await act(async () => { expect(await result.current.saveBody(unsafe, { allowRecoveryWrite: true })).toBe(false) })
    model.allowRecoveryRead()
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(result.current.noteEntry).toEqual(model.canonical)
    expect(result.current.noteReadOnly).toBe(false)
    expect(richEditorDocumentToPlainText(result.current.noteBody).match(/User: Payment failed/g)).toHaveLength(1)
    expect(api.submitChat).toHaveBeenCalledTimes(1)
    expect(api.updateEntry).not.toHaveBeenCalled()
  })

  it('reconciles an uncommitted invocation failure by canonical reads without automatically trying submit again', async () => {
    const model = durableSubmission()
    api.submitChat.mockRejectedValueOnce(new Error('Invoke outcome unknown'))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(result.current.noteReadOnly).toBe(true)
    expect(result.current.sessionChat.chat?.submission).toBeNull()
    await act(async () => { await result.current.sessionChat.onSubmit() })
    expect(result.current.noteEntry).toEqual(model.original)
    expect(model.durableNote()).toEqual(model.original)
    expect(result.current.noteReadOnly).toBe(false)
    expect(result.current.notice).toContain('Submission was not recorded')
    expect(api.submitChat).toHaveBeenCalledTimes(1)
    expect(api.updateEntry).not.toHaveBeenCalled()
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(api.startAiActionJob).not.toHaveBeenCalled()
  })
})
