import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { richEditorDocumentFromHtml, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { draftFixture, findingFixture, providerStatusFixture, sessionFixture } from '../test/fixtures'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const { AppShell } = await import('./AppShell')
const tauri = getTauriMock()
beforeEach(() => {
  setupControllerTest()
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanupControllerTest)

function Workspace() {
  const controller = useAppController()
  return <>
    <button type="button" onClick={() => {
      controller.setSessionTitle('Local title')
      controller.setNoteBody(richEditorDocumentFromHtml('<p><strong>Local rich Note</strong></p>'))
    }}>Set local Note fixture</button>
    <button type="button" onClick={() => {
      const patch = { title: 'Visible unsaved title', ...richEditorDocumentToStoredBody(richEditorDocumentFromHtml('<p><strong>Visible unsaved body</strong></p>')) }
      for (const record of controller.testwareDrafts) controller.updateLocalDraft(record.id, patch)
      for (const record of controller.findings) controller.updateLocalFinding(record.id, patch)
    }}>Set local record fixture</button>
    <AppShell {...controller} />
  </>
}

describe('clipboard and creation wiring', () => {
  it('copies local title and rich Note HTML rather than persisted Session and Entry input', async () => {
    render(<Workspace />)
    await screen.findByRole('textbox', { name: 'Session title' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy note Checkout session' })).toBeEnabled())
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Set local Note fixture' }))
    expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveValue('Local title')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy note Local title' })) })
    expect(tauri.copyHtmlToClipboard.mock.calls).toEqual([['<h2>Local title</h2><p><strong>Local rich Note</strong></p>', '## Local title\n\n**Local rich Note**']])
    expect(tauri.updateSession).not.toHaveBeenCalled()
    expect(tauri.updateEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'note Local title copied' })).toHaveTextContent('Copied')
  })

  it('uses the existing new-Session command once and its availability for the central action', async () => {
    tauri.listRecentSessions.mockResolvedValueOnce([])
    const creation = deferred<ReturnType<typeof sessionFixture>>()
    tauri.createSession.mockReturnValueOnce(creation.promise)
    render(<Workspace />)
    const create = await screen.findByRole('button', { name: 'Start a Session' })
    await waitFor(() => expect(create).toBeEnabled())
    expect(screen.getByRole('button', { name: 'New Session' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open command palette' })).toBeEnabled()
    fireEvent.click(create)
    await waitFor(() => expect(tauri.createSession).toHaveBeenCalledTimes(1))
    expect(create).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New Session' })).toBeDisabled()
    await act(async () => { creation.resolve(sessionFixture()); await creation.promise })
    await screen.findByRole('textbox', { name: 'Session title' })
    expect(screen.queryByRole('button', { name: 'Start a Session' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Session' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Create test cases with AI' })).toBeInTheDocument()
  })

  it.each([
    ['note', 'testware'], ['collection', 'testware'],
    ['note', 'finding'], ['collection', 'finding'],
  ] as const)('creates exactly one editable %s %s without a ready provider', async (route, kind) => {
    const status = providerStatusFixture()
    tauri.getProviderStatus.mockResolvedValue({ ...status, providers: status.providers.map((provider) => ({ ...provider, available: false, reason: 'Not authenticated' })) })
    const record = kind === 'testware' ? draftFixture({ id: 'created-case', title: 'Untitled test case', body: '<p></p>' })
      : findingFixture({ id: 'created-finding', title: 'Untitled finding', body: '<p></p>' })
    const create = kind === 'testware' ? tauri.createDraft : tauri.createFinding
    const list = kind === 'testware' ? tauri.listDrafts : tauri.listFindings
    let saved = false
    tauri.commitCreationSave.mockImplementation(async () => { saved = true; return { state: 'committed', record: { kind, record } } })
    list.mockImplementation(async () => saved ? [record] : [])
    render(<Workspace />)
    await screen.findByRole('textbox', { name: 'Session title' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create finding' })).toBeEnabled())
    if (route === 'collection') fireEvent.click(screen.getByRole('tab', { name: new RegExp(kind === 'testware' ? 'Test cases' : 'Findings') }))
    fireEvent.click(await screen.findByRole('button', { name: kind === 'testware' ? 'Create test cases' : 'Create finding' }))
    const title = await screen.findByRole('textbox', { name: kind === 'testware' ? 'Test case title' : 'Finding title' })
    expect(title).toHaveValue('')
    await waitFor(() => expect(title).toHaveFocus())
    expect(create).not.toHaveBeenCalled()
    expect(tauri.prepareCreationSave).not.toHaveBeenCalled()
    fireEvent.change(title, { target: { value: record.title } })
    fireEvent.click(screen.getByRole('button', { name: kind === 'testware' ? 'Save test cases' : 'Save finding' }))
    await screen.findByRole('heading', { name: record.title })
    expect(tauri.commitCreationSave).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
    expect(tauri.startAiActionJob).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it.each(['note', 'collection'] as const)('opens and cancels AI before creation from the %s', async (route) => {
    render(<Workspace />)
    await screen.findByRole('textbox', { name: 'Session title' })
    if (route === 'collection') fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
    const action = await screen.findByRole('button', { name: 'Create finding with AI' })
    await waitFor(() => expect(action).toBeEnabled())
    fireEvent.click(action)
    const dialog = await screen.findByRole('dialog', { name: 'Create finding?' })
    expect(tauri.createFinding).not.toHaveBeenCalled()
    expect(tauri.createDraft).not.toHaveBeenCalled()
    expect(tauri.startAiActionJob).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(tauri.createFinding).not.toHaveBeenCalled()
    expect(tauri.createDraft).not.toHaveBeenCalled()
    expect(tauri.startAiActionJob).not.toHaveBeenCalled()
  })

  it.each(['testware', 'finding'] as const)('copies visible unsaved %s edits without saving, navigating or clearing dirty state', async (kind) => {
    const saved = kind === 'testware' ? draftFixture() : findingFixture()
    const list = kind === 'testware' ? tauri.listDrafts : tauri.listFindings
    list.mockResolvedValue([saved])
    render(<Workspace />)
    await screen.findByRole('textbox', { name: 'Session title' })
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(kind === 'testware' ? 'Test cases' : 'Findings') }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set local record fixture' }))
    const copy = await screen.findByRole('button', { name: 'Copy Visible unsaved title' })
    await act(async () => { fireEvent.click(copy) })
    expect(tauri.copyHtmlToClipboard.mock.calls).toEqual([['<h2>Visible unsaved title</h2><p><strong>Visible unsaved body</strong></p>', '## Visible unsaved title\n\n**Visible unsaved body**']])
    expect(tauri.updateDraft).not.toHaveBeenCalled()
    expect(tauri.updateFinding).not.toHaveBeenCalled()
    expect(tauri.updateEntry).not.toHaveBeenCalled()
    expect(tauri.updateSession).not.toHaveBeenCalled()
    expect(tauri.startAiActionJob).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: kind === 'testware' ? 'Test case title' : 'Finding title' })).toHaveValue('Visible unsaved title')
    fireEvent.click(screen.getByRole('tab', { name: /Note/ }))
    const guard = await screen.findByRole('dialog')
    expect(guard).toHaveTextContent(/unsaved|changes/i)
  })

})
