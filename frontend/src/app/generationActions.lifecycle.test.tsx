import { StrictMode, useEffect } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, generationStatusFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, serializeRichEditorDocument } from '../editor/editorDocument'
import { useGenerationActions, type GenerationActionsContext } from './generationActions'

const commands = vi.hoisted(() => ({ listActiveAiActionJobs: vi.fn(), getAiActionJobStatus: vi.fn(), openSessionNoteState: vi.fn(), cancelAiActionJob: vi.fn() }))
vi.mock('../tauri', async (original) => ({ ...await original<object>(), ...commands }))

function context(): GenerationActionsContext {
  const body = richEditorDocumentFromPlainText('Authored Note')
  return {
    session: { activeSession: sessionFixture(), activeSessionIdRef: { current: 'session-1' }, noteEntry: entryFixture(), noteEntryIdRef: { current: 'entry-1' }, noteBodyRef: { current: body }, savedBodyRef: { current: serializeRichEditorDocument(body) }, setNoteEntry: vi.fn(), setNoteBody: vi.fn() },
    records: { dirtyDraftIdsRef: { current: new Set() }, dirtyFindingIdsRef: { current: new Set() }, draftsRef: { current: [] }, findingsRef: { current: [] }, setDrafts: vi.fn(), setFindings: vi.fn(), setFindingCount: vi.fn(), setTestwareDraftCount: vi.fn() },
    generation: { latestNoteGenerationUndo: null, setGenerationJobs: vi.fn(), setLatestNoteGenerationUndo: vi.fn() },
    latestNoteGenerationUndoRef: { current: null },
    summaryRecovery: { recoveredJobsRef: { current: new Map() }, unresolvedSummaryJobsRef: { current: new Map() }, completedSummaryEntriesRef: { current: new Map() }, openingSessionIdRef: { current: null }, discoveryPendingRef: { current: true }, blockedSaveSessionIdsRef: { current: new Set() } },
    selection: { selectedProvider: 'codex_cli', selectedModel: 'default', selectedReasoningEffort: null },
    feedback: { setBusyAction: vi.fn(), setError: vi.fn(), setNotice: vi.fn() }, navigation: { setActiveView: vi.fn() },
    saveNoteNow: vi.fn(async () => true), saveNoteBody: vi.fn(async () => true), adoptCanonicalNoteBody: vi.fn(), canonicalizeGeneratedDraft: vi.fn(async () => {}), canonicalizeGeneratedFinding: vi.fn(async () => {}),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
const running = () => generationStatusFixture({ jobId: 'recovered-summary', action: 'summary', state: 'running' })
const completed = () => generationStatusFixture({ jobId: 'recovered-summary', action: 'summary', state: 'completed' })
const canonical = () => ({ session: sessionFixture(), noteEntry: entryFixture({ body: '<p>Canonical Summary</p>' }), testwareDraftCount: 0, findingCount: 0 })

async function start(actions: ReturnType<typeof useGenerationActions>) {
  await act(async () => { await actions.captureActiveJobs(); await actions.reconcileActiveJobs() })
}

describe('recovered generation observer lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    commands.listActiveAiActionJobs.mockResolvedValue([running()])
    commands.getAiActionJobStatus.mockResolvedValue(running())
    commands.openSessionNoteState.mockResolvedValue(canonical())
  })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('stops scheduled status reads on unmount without cancelling the backend job', async () => {
    const { result, unmount } = renderHook(() => useGenerationActions(context()))
    await start(result.current)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(commands.getAiActionJobStatus).not.toHaveBeenCalled()
    expect(commands.cancelAiActionJob).not.toHaveBeenCalled()
  })

  it('ignores status completion after unmount and preserves unresolved write protection', async () => {
    const status = deferred<ReturnType<typeof completed>>()
    commands.getAiActionJobStatus.mockReturnValue(status.promise)
    const ctx = context()
    const { result, unmount } = renderHook(() => useGenerationActions(ctx))
    await start(result.current)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    unmount()
    await act(async () => { status.resolve(completed()); await status.promise })
    expect(commands.openSessionNoteState).not.toHaveBeenCalled()
    expect(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.get('recovered-summary')).toBe('session-1')
    expect(ctx.feedback.setNotice).not.toHaveBeenCalled()
  })

  it('ignores canonical completion after unmount without adopting content or releasing its guard', async () => {
    const read = deferred<ReturnType<typeof canonical>>()
    commands.getAiActionJobStatus.mockResolvedValue(completed())
    commands.openSessionNoteState.mockReturnValue(read.promise)
    const ctx = context()
    const { result, unmount } = renderHook(() => useGenerationActions(ctx))
    await start(result.current)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(commands.openSessionNoteState).toHaveBeenCalledWith('session-1')
    unmount()
    await act(async () => { read.resolve(canonical()); await read.promise })
    expect(ctx.session.setNoteBody).not.toHaveBeenCalled()
    expect(ctx.adoptCanonicalNoteBody).not.toHaveBeenCalled()
    expect(ctx.saveNoteBody).not.toHaveBeenCalled()
    expect(ctx.feedback.setNotice).not.toHaveBeenCalled()
    expect(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.get('recovered-summary')).toBe('session-1')
  })

  it('reconciles duplicate captures with a single observer for the same job', async () => {
    const { result } = renderHook(() => useGenerationActions(context()))
    await start(result.current)
    await start(result.current)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(commands.getAiActionJobStatus).toHaveBeenCalledTimes(1)
    expect(commands.getAiActionJobStatus).toHaveBeenCalledWith('recovered-summary')
  })

  it('stops canonical retries when unmounted during the retry delay', async () => {
    commands.getAiActionJobStatus.mockResolvedValue(completed())
    commands.openSessionNoteState.mockRejectedValue(new Error('temporarily unavailable'))
    const ctx = context()
    const { result, unmount } = renderHook(() => useGenerationActions(ctx))
    await start(result.current)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(commands.openSessionNoteState).toHaveBeenCalledTimes(1)
    expect(ctx.feedback.setError).not.toHaveBeenCalled()
    expect(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.get('recovered-summary')).toBe('session-1')
  })

  it('retains unresolved protection after exhausting status retries', async () => {
    commands.getAiActionJobStatus.mockRejectedValue(new Error('status unavailable'))
    const ctx = context()
    const { result } = renderHook(() => useGenerationActions(ctx))
    await start(result.current)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(commands.getAiActionJobStatus).toHaveBeenCalledTimes(3)
    expect(ctx.feedback.setError).toHaveBeenCalledWith('Something went wrong: status unavailable')
    expect(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.get('recovered-summary')).toBe('session-1')
  })

  it('can recover after StrictMode setup and cleanup with one active observer', async () => {
    commands.getAiActionJobStatus.mockResolvedValue(completed())
    const ctx = context()
    renderHook(() => {
      const actions = useGenerationActions(ctx)
      useEffect(() => { void actions.captureActiveJobs().then(actions.reconcileActiveJobs) }, [actions])
    }, { wrapper: StrictMode })
    await act(async () => { await Promise.resolve() })
    expect(commands.listActiveAiActionJobs).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(commands.getAiActionJobStatus).toHaveBeenCalledTimes(1)
    expect(ctx.session.setNoteBody).toHaveBeenCalledOnce()
    expect(ctx.feedback.setNotice).toHaveBeenCalledWith('Generation finished')
    expect(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.size).toBe(0)
  })

  it.each([
    { jobId: 'foreign-job' },
    { sessionId: 'foreign-session' },
    { action: 'finding' as const },
  ])('rejects a recovered status with foreign identity %j', async (patch) => {
    commands.getAiActionJobStatus.mockResolvedValue({ ...completed(), ...patch })
    const ctx = context()
    const { result } = renderHook(() => useGenerationActions(ctx))
    await start(result.current)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(commands.openSessionNoteState).not.toHaveBeenCalled()
    expect(ctx.feedback.setError).toHaveBeenCalledWith('Something went wrong: Generation job status returned an unexpected Session or action.')
    expect(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.get('recovered-summary')).toBe('session-1')
  })

  it('ignores discovery completion after unmount while retaining discovery protection', async () => {
    const discovery = deferred<ReturnType<typeof running>[]>()
    commands.listActiveAiActionJobs.mockReturnValue(discovery.promise)
    const ctx = context()
    const { result, unmount } = renderHook(() => useGenerationActions(ctx))
    const capture = result.current.captureActiveJobs()
    unmount()
    await act(async () => { discovery.resolve([running()]); await capture })
    expect(ctx.generation.setGenerationJobs).not.toHaveBeenCalled()
    expect(ctx.summaryRecovery.discoveryPendingRef.current).toBe(true)
  })

  it('rechecks an unresolved Summary absent from a fresh active snapshot after status retry exhaustion', async () => {
    commands.getAiActionJobStatus.mockRejectedValue(new Error('status unavailable'))
    const ctx = context()
    const { result } = renderHook(() => useGenerationActions(ctx))
    await start(result.current)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(commands.getAiActionJobStatus).toHaveBeenCalledTimes(3)
    expect(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.get('recovered-summary')).toBe('session-1')
    commands.listActiveAiActionJobs.mockResolvedValue([])
    commands.getAiActionJobStatus.mockResolvedValue(completed())
    await start(result.current)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(commands.getAiActionJobStatus).toHaveBeenCalledTimes(4)
    expect(ctx.session.setNoteBody).toHaveBeenCalledOnce()
    expect(ctx.feedback.setNotice).toHaveBeenCalledWith('Generation finished')
    expect(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.size).toBe(0)
  })

  it('ignores an older capture that resolves after the current capture', async () => {
    const older = deferred<ReturnType<typeof running>[]>()
    commands.listActiveAiActionJobs.mockReturnValueOnce(older.promise).mockResolvedValueOnce([])
    const ctx = context()
    const { result } = renderHook(() => useGenerationActions(ctx))
    const oldCapture = result.current.captureActiveJobs()
    await start(result.current)
    await act(async () => { older.resolve([running()]); await oldCapture; await vi.advanceTimersByTimeAsync(1000) })
    expect(commands.getAiActionJobStatus).not.toHaveBeenCalled()
    expect(ctx.generation.setGenerationJobs).not.toHaveBeenCalled()
    expect(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.size).toBe(0)
    expect(ctx.summaryRecovery.discoveryPendingRef.current).toBe(false)
  })

})
