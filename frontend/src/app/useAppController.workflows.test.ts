import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftFixture, entryFixture, findingFixture, generationStatusFixture, providerStatusFixture, sessionFixture, settingsFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import { writeCachedProviderStatus } from '../settings/providerStatusCache'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController workflows and record hydration', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)
  it('keeps busy state truthy for the full outer action even though the inner save resolves first', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('unsaved before manual testware'))
    })

    let resolveCreateDraft: (draft: ReturnType<typeof draftFixture>) => void = () => {}
    tauriMock.createDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreateDraft = resolve
      }),
    )

    let actionPromise!: Promise<void>
    act(() => {
      actionPromise = result.current.handleManualTestware()
    })

    // Let the inner saveNoteNow (saveTitle/saveBody) resolve while createDraft is still pending.
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalled())
    expect(result.current.isBusy).toBe(true)
    expect(result.current.busyAction).toBe('manual-testware')

    act(() => {
      resolveCreateDraft(draftFixture({ id: 'draft-1' }))
    })
    await act(async () => {
      await actionPromise
    })

    expect(result.current.isBusy).toBe(false)
  })

  it('records startup timing marks and keeps deep CLI discovery outside boot', async () => {
    const marks: string[] = []
    const measures: string[] = []
    const markSpy = vi.spyOn(performance, 'mark').mockImplementation((name) => {
      marks.push(String(name))
      return undefined as unknown as PerformanceMark
    })
    const measureSpy = vi.spyOn(performance, 'measure').mockImplementation((name) => {
      measures.push(String(name))
      return undefined as unknown as PerformanceMeasure
    })

    try {
      const fastStatus = providerStatusFixture()
      fastStatus.providers[0].defaultSnapshot = {
        ...fastStatus.providers[0].defaultSnapshot,
        state: 'unchecked',
        checkedAt: null,
      }
      tauriMock.getProviderStatus.mockResolvedValueOnce(fastStatus)
      const { result } = renderHook(() => useAppController())

      await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
      await waitFor(() => expect(tauriMock.getProviderStatus).toHaveBeenCalled())
      await act(async () => Promise.resolve())

      expect(result.current.busyAction).toBeNull()
      expect(tauriMock.refreshProviderStatus).not.toHaveBeenCalled()
      expect(tauriMock.listRecentSessions).toHaveBeenCalledWith(50)
      expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-1')
      expect(tauriMock.listSessions).not.toHaveBeenCalled()
      expect(tauriMock.listEntries).not.toHaveBeenCalled()
      expect(tauriMock.listDrafts).not.toHaveBeenCalled()
      expect(tauriMock.listFindings).not.toHaveBeenCalled()
      expect(marks).toEqual(
        expect.arrayContaining([
          'qa-scribe:startup:boot-start',
          'qa-scribe:startup:settings-loaded',
          'qa-scribe:startup:sessions-loaded',
          'qa-scribe:startup:first-session-opened',
          'qa-scribe:startup:boot-busy-cleared',
          'qa-scribe:startup:provider-fast-status-complete',
        ]),
      )
      expect(measures).toEqual(
        expect.arrayContaining([
          'qa-scribe startup boot-to-settings-loaded',
          'qa-scribe startup boot-to-sessions-loaded',
          'qa-scribe startup boot-to-first-session-opened',
          'qa-scribe startup boot-to-busy-cleared',
          'qa-scribe startup boot-to-provider-fast-status',
        ]),
      )
      expect(marks).not.toContain('qa-scribe:startup:provider-deep-refresh-complete')
      expect(measures).not.toContain('qa-scribe startup boot-to-provider-deep-refresh')

      act(() => result.current.openSettingsSection('ai-execution-settings'))
      await waitFor(() => expect(tauriMock.refreshProviderStatus).toHaveBeenCalledTimes(1))

      await act(async () => {
        await result.current.handleRefreshProviderStatus()
      })

      expect(tauriMock.refreshProviderStatus).toHaveBeenCalledTimes(2)
      expect(marks).toContain('qa-scribe:startup:provider-deep-refresh-complete')
      expect(measures).toContain('qa-scribe startup boot-to-provider-deep-refresh')
    } finally {
      markSpy.mockRestore()
      measureSpy.mockRestore()
    }
  })

  it('shows the cached CLI default after restart without deep discovery during boot', async () => {
    writeCachedProviderStatus(providerStatusFixture())
    const fastStatus = providerStatusFixture()
    fastStatus.providers[0].defaultSnapshot = {
      ...fastStatus.providers[0].defaultSnapshot,
      state: 'unchecked',
      checkedAt: null,
    }
    fastStatus.providers[0].models = fastStatus.providers[0].models.slice(0, 1)
    tauriMock.getProviderStatus.mockResolvedValueOnce(fastStatus)

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(result.current.providerDiscoveryState).toBe('stale'))
    expect(result.current.effectiveAiSelection?.model).toBe('gpt-5.5')
    expect(tauriMock.refreshProviderStatus).not.toHaveBeenCalled()
  })

  it('keeps full Session Library loading explicit after bounded boot', async () => {
    const recentSessions = Array.from({ length: 50 }, (_, index) => sessionFixture({ id: `session-${index + 1}`, title: `Recent ${index + 1}` }))
    const fullSessions = [...recentSessions, sessionFixture({ id: 'session-older', title: 'Older session' })]
    tauriMock.listRecentSessions.mockResolvedValueOnce(recentSessions)
    tauriMock.listSessions.mockResolvedValueOnce(fullSessions)
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        session: recentSessions[0],
        noteEntry: entryFixture({ sessionId: recentSessions[0].id }),
      }),
    )

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    expect(result.current.sessionLibraryComplete).toBe(false)
    expect(tauriMock.listSessions).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.handleLoadSessionLibrary()
    })

    expect(tauriMock.listSessions).toHaveBeenCalledTimes(1)
    expect(result.current.sessions).toHaveLength(51)
    expect(result.current.sessionLibraryComplete).toBe(true)
  })

  it('preserves a Settings edit made while the previous draft is saving', async () => {
    const pendingSave = deferred<ReturnType<typeof settingsFixture>>()
    tauriMock.updateSettings.mockReturnValueOnce(pendingSave.promise)
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.updateSettingsDraft({ testwareTemplate: 'First edit' }))

    let savePromise!: Promise<void>
    act(() => {
      savePromise = result.current.handleSaveSettings()
    })
    await waitFor(() => expect(tauriMock.updateSettings).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.updateSettingsDraft({ testwareTemplate: 'Edit typed while saving' })
      pendingSave.resolve(settingsFixture({ testwareTemplate: 'First edit' }))
    })
    await act(async () => savePromise)

    expect(result.current.settingsDraft?.testwareTemplate).toBe('Edit typed while saving')
    expect(result.current.settingsDirty).toBe(true)
    expect(result.current.settingsSaveState).toBe('idle')
  })

  it('loads Drafts and Findings lazily when their views are opened', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        testwareDraftCount: 1,
        findingCount: 1,
      }),
    )
    tauriMock.listDrafts.mockResolvedValueOnce([draftFixture({ id: 'draft-lazy' })])
    tauriMock.listFindings.mockResolvedValueOnce([findingFixture({ id: 'finding-lazy' })])

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    expect(tauriMock.listDrafts).not.toHaveBeenCalled()
    expect(tauriMock.listFindings).not.toHaveBeenCalled()
    expect(result.current.testwareDraftCount).toBe(1)
    expect(result.current.findingCount).toBe(1)

    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-lazy']))
    expect(tauriMock.listDrafts).toHaveBeenCalledWith('session-1')

    act(() => {
      result.current.setActiveView('findings')
    })
    await waitFor(() => expect(result.current.findings.map((finding) => finding.id)).toEqual(['finding-lazy']))
    expect(tauriMock.listFindings).toHaveBeenCalledWith('session-1')
  })

  it('loads existing Drafts before choosing a manual testware title', async () => {
    tauriMock.listDrafts
      .mockResolvedValueOnce([draftFixture({ id: 'draft-existing', title: 'Untitled testware' })])
      .mockResolvedValueOnce([
        draftFixture({ id: 'draft-new', title: 'Untitled testware 2' }),
        draftFixture({ id: 'draft-existing', title: 'Untitled testware' }),
      ])
    tauriMock.createDraft.mockResolvedValueOnce(draftFixture({ id: 'draft-new', title: 'Untitled testware 2' }))

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => {
      await result.current.handleManualTestware()
    })

    expect(tauriMock.listDrafts).toHaveBeenCalledWith('session-1')
    expect(tauriMock.createDraft).toHaveBeenCalledWith(expect.objectContaining({ title: 'Untitled testware 2' }))
    expect(result.current.testwareDraftCount).toBe(2)
  })

  it('does not clobber a generated Draft when a stale lazy load resolves', async () => {
    const pendingDrafts = deferred<ReturnType<typeof draftFixture>[]>()
    tauriMock.listDrafts.mockReturnValueOnce(pendingDrafts.promise)
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent({
        type: 'completed',
        job_id: 'job-1',
        status: generationStatusFixture({ jobId: 'job-1', action: 'testware', state: 'completed' }),
        result: {
          generationContext: { id: 'context-1', sessionId: 'session-1', createdAt: '2026-06-24T10:00:00.000Z' },
          aiRun: {
            id: 'run-1',
            sessionId: 'session-1',
            generationContextId: 'context-1',
            provider: 'codex_cli',
            model: 'default',
            reasoningEffort: null,
            promptVersion: 'testware-v4',
            status: 'completed',
            errorMessage: null,
            createdAt: '2026-06-24T10:00:00.000Z',
            completedAt: '2026-06-24T10:00:00.000Z',
          },
          draft: draftFixture({ id: 'draft-generated', sessionId: 'session-1' }),
          finding: null,
          noteEntry: null,
        },
      })
      return { jobId: 'job-1', status: generationStatusFixture({ jobId: 'job-1', action: 'testware', state: 'completed' }) }
    })

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(tauriMock.listDrafts).toHaveBeenCalledWith('session-1'))

    await act(async () => {
      await result.current.handleAiAction('testware')
    })
    expect(result.current.testwareDrafts.map((draft) => draft.id)).toContain('draft-generated')

    await act(async () => {
      pendingDrafts.resolve([draftFixture({ id: 'draft-from-stale-load', sessionId: 'session-1' })])
      await pendingDrafts.promise
    })

    expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(expect.arrayContaining(['draft-generated', 'draft-from-stale-load']))
  })

  it('preserves dirty Draft edits when a forced same-Session refresh resolves', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        testwareDraftCount: 1,
      }),
    )
    tauriMock.listDrafts
      .mockResolvedValueOnce([draftFixture({ id: 'draft-dirty', sessionId: 'session-1', body: '<p>Persisted draft.</p>' })])
      .mockResolvedValueOnce([draftFixture({ id: 'draft-dirty', sessionId: 'session-1', body: '<p>Server refresh body.</p>' })])
    tauriMock.createDraft.mockResolvedValueOnce(draftFixture({ id: 'draft-new', sessionId: 'session-1', title: 'Untitled testware' }))

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-dirty']))

    act(() => {
      result.current.updateLocalDraft('draft-dirty', { body: '<p>Unsaved local draft.</p>' })
    })

    await act(async () => {
      await result.current.handleManualTestware()
    })

    expect(result.current.testwareDrafts.find((draft) => draft.id === 'draft-dirty')?.body).toBe('<p>Unsaved local draft.</p>')
  })

  it('does not let generated Draft canonicalization overwrite a dirty local edit', async () => {
    let resolveUpdateDraft: (draft: ReturnType<typeof draftFixture>) => void = () => {}
    tauriMock.updateDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdateDraft = resolve
      }),
    )
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent({
        type: 'completed',
        job_id: 'job-1',
        status: generationStatusFixture({ jobId: 'job-1', action: 'testware', state: 'completed' }),
        result: {
          generationContext: { id: 'context-1', sessionId: 'session-1', createdAt: '2026-06-24T10:00:00.000Z' },
          aiRun: {
            id: 'run-1',
            sessionId: 'session-1',
            generationContextId: 'context-1',
            provider: 'codex_cli',
            model: 'default',
            reasoningEffort: null,
            promptVersion: 'testware-v4',
            status: 'completed',
            errorMessage: null,
            createdAt: '2026-06-24T10:00:00.000Z',
            completedAt: '2026-06-24T10:00:00.000Z',
          },
          draft: draftFixture({ id: 'draft-generated', sessionId: 'session-1', body: '<p>Generated body.</p>' }),
          finding: null,
          noteEntry: null,
        },
      })
      return { jobId: 'job-1', status: generationStatusFixture({ jobId: 'job-1', action: 'testware', state: 'completed' }) }
    })

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => {
      await result.current.handleAiAction('testware')
    })

    act(() => {
      result.current.updateLocalDraft('draft-generated', { body: '<p>Unsaved edit after generation.</p>' })
      resolveUpdateDraft(draftFixture({ id: 'draft-generated', sessionId: 'session-1', body: '<p>Canonical server body.</p>' }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.testwareDrafts.find((draft) => draft.id === 'draft-generated')?.body).toBe('<p>Unsaved edit after generation.</p>')
  })

  it('materializes inline data images before saving a dirty Draft', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        testwareDraftCount: 1,
      }),
    )
    tauriMock.listDrafts.mockResolvedValueOnce([draftFixture({ id: 'draft-inline', sessionId: 'session-1', body: '<p>Persisted draft.</p>' })])

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-inline']))

    act(() => {
      result.current.updateLocalDraft('draft-inline', { body: '<p><img src="data:image/png;base64,AAAA" alt="Evidence" /></p>' })
    })
    await act(async () => {
      await result.current.handleSaveDraft(result.current.testwareDrafts[0])
    })

    expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledWith({
      sessionId: 'session-1',
      entryId: null,
      filename: 'Evidence.png',
      dataUrl: 'data:image/png;base64,AAAA',
    })
    expect(tauriMock.updateDraft).toHaveBeenCalledWith(
      'draft-inline',
      expect.objectContaining({
        body: expect.stringContaining('qa-scribe-attachment://attachment-1'),
      }),
    )
    expect(tauriMock.updateDraft).toHaveBeenCalledWith(
      'draft-inline',
      expect.objectContaining({
        body: expect.not.stringContaining('data:image/png'),
      }),
    )
  })

  it('keeps a Draft dirty when another edit happens while save is in flight', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        testwareDraftCount: 1,
      }),
    )
    tauriMock.listDrafts.mockResolvedValueOnce([draftFixture({ id: 'draft-race', sessionId: 'session-1', body: '<p>Persisted draft.</p>' })])
    let resolveUpdateDraft: (draft: ReturnType<typeof draftFixture>) => void = () => {}
    tauriMock.updateDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdateDraft = resolve
      }),
    )

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-race']))

    act(() => {
      result.current.updateLocalDraft('draft-race', { body: '<p>First unsaved edit.</p>' })
    })
    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = result.current.handleSaveDraft(result.current.testwareDrafts[0])
    })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledWith('draft-race', expect.objectContaining({ body: '<p>First unsaved edit.</p>' })))

    act(() => {
      result.current.updateLocalDraft('draft-race', { body: '<p>Edit typed while saving.</p>' })
      resolveUpdateDraft(draftFixture({ id: 'draft-race', sessionId: 'session-1', body: '<p>First unsaved edit.</p>' }))
    })
    await act(async () => {
      await savePromise
    })

    expect(result.current.testwareDrafts.find((draft) => draft.id === 'draft-race')?.body).toBe('<p>Edit typed while saving.</p>')

    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        session: otherSession,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }),
    )
    await act(async () => {
      await result.current.openSession(otherSession)
    })

    expect(tauriMock.updateDraft).toHaveBeenLastCalledWith('draft-race', expect.objectContaining({ body: '<p>Edit typed while saving.</p>' }))
    expect(result.current.activeSession?.id).toBe('session-2')
  })

})
