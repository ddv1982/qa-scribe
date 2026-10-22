import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { richEditorDocumentFromHtml } from '../editor/editorDocument'
import { draftFixture, findingFixture } from '../test/fixtures'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauri = getTauriMock()
beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.unstubAllGlobals() })

describe('copy and workflow isolation', () => {
  it('copies saved library input without settling or writing unrelated dirty local Note, Draft and Finding edits', async () => {
    tauri.listDrafts.mockResolvedValue([draftFixture()])
    tauri.listFindings.mockResolvedValue([findingFixture()])
    const { result } = renderHook(useAppController)
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toHaveLength(1))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toHaveLength(1))
    vi.useFakeTimers()
    act(() => {
      result.current.setSessionTitle('Local unsaved Session title')
      result.current.setNoteBody(richEditorDocumentFromHtml('<p>Local unsaved Note</p>'))
      result.current.updateLocalDraft('draft-1', { body: '<p>Local unsaved Draft</p>' })
      result.current.updateLocalFinding('finding-1', { body: '<p>Local unsaved Finding</p>' })
      result.current.setError('Unrelated workflow error')
    })
    const before = { activeSession: result.current.activeSession, activeView: result.current.activeView, note: result.current.noteBody, title: result.current.sessionTitle, drafts: result.current.testwareDrafts, findings: result.current.findings, notice: result.current.notice }
    vi.clearAllMocks()
    tauri.copyHtmlToClipboard.mockResolvedValue(undefined)
    await act(async () => result.current.copy({ target: { kind: 'draft', sessionId: 'other-session', id: 'saved-library', action: 'jira-text' }, title: 'Same', bodyHtml: '<p><strong>Saved library</strong></p>' }))
    expect(tauri.copyHtmlToClipboard.mock.calls).toEqual([['<h2>Same</h2><p><strong>Saved library</strong></p>', '## Same\n\n**Saved library**']])
    for (const command of [tauri.updateSession, tauri.updateEntry, tauri.updateDraft, tauri.updateFinding, tauri.openSessionNoteState, tauri.reopenSession, tauri.listDrafts, tauri.listFindings, tauri.listDraftLibrary, tauri.listFindingLibrary]) expect(command).not.toHaveBeenCalled()
    expect({ activeSession: result.current.activeSession, activeView: result.current.activeView, note: result.current.noteBody, title: result.current.sessionTitle, drafts: result.current.testwareDrafts, findings: result.current.findings, notice: result.current.notice }).toEqual(before)
    expect(result.current.pendingNavigationView).toBeNull()
    expect(result.current.noteBodyHtml).toBe('<p>Local unsaved Note</p>')
    expect(result.current.error).toBe('Unrelated workflow error')
    expect(result.current.busyAction).toBeNull()
    expect(result.current.isBusy).toBe(false)
  })

  it.each(['succeeded', 'failed'] as const)('leaves an unrelated save and its feedback intact when copy %s', async (outcome) => {
    const draft = draftFixture()
    tauri.listDrafts.mockResolvedValue([draft])
    const { result } = renderHook(useAppController)
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toHaveLength(1))
    let settleCopy!: () => void
    tauri.copyHtmlToClipboard.mockReturnValueOnce(new Promise<void>((resolve, reject) => { settleCopy = () => outcome === 'succeeded' ? resolve() : reject(new Error('Native rejected')) }))
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Browser rejected')) } })
    let copy!: Promise<void>
    act(() => { copy = result.current.copy({ target: { kind: 'draft', sessionId: 'other', id: 'library', action: 'jira-text' }, title: 'Saved', bodyHtml: '<p>Saved</p>' }) })
    expect(result.current.isBusy).toBe(false)
    const save = deferred<typeof draft>()
    tauri.updateDraft.mockReturnValueOnce(save.promise)
    let saving!: Promise<boolean>
    act(() => { saving = result.current.handleSaveDraft(draft) })
    await waitFor(() => expect(result.current.busyAction).toBe(`draft:${draft.id}`))
    act(() => result.current.setError('Independent save diagnostic'))
    const notice = result.current.notice
    await act(async () => { settleCopy(); await copy })
    expect(result.current.copyState.status).toBe(outcome)
    expect(result.current.busyAction).toBe(`draft:${draft.id}`)
    expect(result.current.error).toBe('Independent save diagnostic')
    expect(result.current.notice).toBe(notice)
    await act(async () => { save.resolve(draft); await saving })
  })
})
