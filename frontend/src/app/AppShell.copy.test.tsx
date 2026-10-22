import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { richEditorDocumentFromHtml } from '../editor/editorDocument'
import { sessionFixture } from '../test/fixtures'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const { AppShell } = await import('./AppShell')
const tauri = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

function Workspace() {
  const controller = useAppController()
  return <>
    <button type="button" onClick={() => {
      controller.setSessionTitle('Local title')
      controller.setNoteBody(richEditorDocumentFromHtml('<p><strong>Local rich Note</strong></p>'))
    }}>Set local Note fixture</button>
    <AppShell {...controller} />
  </>
}

describe('clipboard and creation wiring', () => {
  it('copies local title and rich Note HTML rather than persisted Session and Entry input', async () => {
    render(<Workspace />)
    await screen.findByRole('textbox', { name: 'Session title' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy note for Jira' })).toBeEnabled())
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Set local Note fixture' }))
    expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveValue('Local title')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy note for Jira' })) })
    expect(tauri.copyHtmlToClipboard.mock.calls).toEqual([['<h2>Local title</h2><p><strong>Local rich Note</strong></p>', '## Local title\n\n**Local rich Note**']])
    expect(tauri.updateSession).not.toHaveBeenCalled()
    expect(tauri.updateEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Note copied for Jira' })).toHaveTextContent('Copied for Jira')
  })

  it('uses the existing new-Session command once and its availability for the central action', async () => {
    tauri.listRecentSessions.mockResolvedValueOnce([])
    const creation = deferred<ReturnType<typeof sessionFixture>>()
    tauri.createSession.mockReturnValueOnce(creation.promise)
    render(<Workspace />)
    const create = await screen.findByRole('button', { name: 'Create Session' })
    await waitFor(() => expect(create).toBeEnabled())
    expect(screen.getByRole('button', { name: 'New Session' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open command palette' })).toBeEnabled()
    fireEvent.click(create)
    await waitFor(() => expect(tauri.createSession).toHaveBeenCalledTimes(1))
    expect(create).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New Session' })).toBeDisabled()
    await act(async () => { creation.resolve(sessionFixture()); await creation.promise })
    await screen.findByRole('textbox', { name: 'Session title' })
    expect(screen.queryByRole('button', { name: 'Create Session' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Session' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Generate test cases' })).toBeInTheDocument()
  })
})
