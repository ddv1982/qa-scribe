import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { simulateDialogCancel } from '../test/dialogPolyfill'
import { entryFixture, findingFixture, providerStatusFixture, sessionFixture } from '../test/fixtures'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const { AppShell } = await import('./AppShell')
const api = getTauriMock()
function Workspace() { return <AppShell {...useAppController()} /> }

beforeEach(() => {
  setupControllerTest()
  userEvent.setup()
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanupControllerTest()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openExample() {
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Help' })).getByRole('button', { name: 'Explore an example' }))
  return screen.getByRole<HTMLDialogElement>('dialog', { name: 'Explore an example' })
}

function effects() {
  return Object.fromEntries(Object.entries(api).filter(([name, value]) =>
    typeof value === 'function' && /^(create|update|delete|import|start|submit|refresh|save|restart|getProvider)/.test(name))
    .map(([name, value]) => [name, (value as ReturnType<typeof vi.fn>).mock.calls.length]))
}

describe('first use and Help', () => {
  it('explores a fresh no-provider library without mutations, provider probes, clipboard writes, or uploads', async () => {
    api.listRecentSessions.mockResolvedValueOnce([])
    const status = providerStatusFixture()
    api.getProviderStatus.mockResolvedValueOnce({ ...status, providers: status.providers.map((provider) => ({ ...provider, available: false, status: 'installRequired' })) })
    const clipboard = vi.fn()
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText: clipboard } as unknown as Clipboard)
    const upload = vi.fn()
    vi.stubGlobal('fetch', upload)
    render(<Workspace />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start a Session' })).toBeEnabled())
    await waitFor(() => expect(api.getProviderStatus).toHaveBeenCalledOnce())
    expect(screen.getByRole('heading', { name: 'Turn testing evidence into useful output' })).toBeInTheDocument()
    const before = effects()
    fireEvent.click(screen.getByRole('button', { name: 'Explore an example' }))
    const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Explore an example' })
    expect(within(dialog).getByRole('region', { name: 'Example Note' })).toHaveTextContent('With an empty postcode')
    expect(within(dialog).getByRole('region', { name: 'Example Finding' })).toHaveTextContent('Ask for a postcode and keep the order unsubmitted.')
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', expect.stringContaining('example-evidence.png'))
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.paste(dialog, { clipboardData: { files: [new File(['image'], 'image.png', { type: 'image/png' })] } })
    act(() => simulateDialogCancel(dialog))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(effects()).toEqual(before)
    expect(clipboard).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('keeps returning users in their Session and opens searchable Help from the keyboard with one cancel and focus return', async () => {
    const user = userEvent.setup()
    render(<Workspace />)
    await screen.findByRole('textbox', { name: 'Session title' })
    expect(screen.queryByText('Turn testing evidence into useful output')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'Open command palette' })
    trigger.focus()
    await user.keyboard('{Control>}k{/Control}')
    const palette = screen.getByRole('dialog', { name: 'Command palette' })
    await user.type(within(palette).getByRole('searchbox'), 'help')
    await user.keyboard('{ArrowDown}{Enter}')
    const help = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Help' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(help).getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.keyboard('{Control>}n{/Control}')
    expect(api.createSession).not.toHaveBeenCalled()
    act(() => simulateDialogCancel(help))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveValue('Checkout session')
    const visibleHelp = screen.getByRole('button', { name: 'Help' })
    visibleHelp.focus()
    await user.keyboard('{Enter}')
    act(() => simulateDialogCancel(screen.getByRole<HTMLDialogElement>('dialog', { name: 'Help' })))
    expect(visibleHelp).toHaveFocus()
  })

  it.each(['Help', 'Commands'] as const)('keeps Help to Example focus inside the modal and returns to the original %s opener on one cancel', async (entry) => {
    const user = userEvent.setup()
    render(<Workspace />)
    await screen.findByRole('textbox', { name: 'Session title' })
    const opener = screen.getByRole('button', { name: entry === 'Help' ? 'Help' : 'Open command palette' })
    opener.focus()
    if (entry === 'Help') {
      await user.keyboard('{Enter}')
    } else {
      await user.keyboard('{Control>}k{/Control}')
      await user.type(within(screen.getByRole('dialog', { name: 'Command palette' })).getByRole('searchbox'), 'help')
      await user.keyboard('{ArrowDown}{Enter}')
    }
    const help = screen.getByRole('dialog', { name: 'Help' })
    expect(within(help).getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.tab()
    expect(within(help).getByRole('button', { name: 'Explore an example' })).toHaveFocus()
    await user.keyboard('{Enter}')
    const example = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Explore an example' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(example.contains(document.activeElement)).toBe(true)
    expect(within(example).getByRole('button', { name: 'Close' })).toHaveFocus()
    act(() => simulateDialogCancel(example))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveValue('Checkout session')
    expect(api.createSession).not.toHaveBeenCalled()
    expect(api.startAiActionJob).not.toHaveBeenCalled()
  })

  it('switches Sessions through the compact select and keeps Help and Settings independently reachable', async () => {
    const user = userEvent.setup()
    const sessions = [sessionFixture(), sessionFixture({ id: 'session-2', title: 'Account recovery' })]
    api.listRecentSessions.mockResolvedValueOnce(sessions)
    api.openSessionNoteState.mockImplementation(async (id: string) => sessionNoteStateFixture({
      session: sessions.find((session) => session.id === id)!,
      noteEntry: entryFixture({ id: `entry-${id}`, sessionId: id }),
    }))
    render(<Workspace />)
    await screen.findByRole('textbox', { name: 'Session title' })
    const select = screen.getByRole('combobox', { name: 'Session' })
    expect(select).toBeEnabled()
    await user.selectOptions(select, 'session-2')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveValue('Account recovery'))
    expect(select).toHaveValue('session-2')
    await user.click(screen.getByRole('button', { name: 'Help' }))
    const help = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Help' })
    expect(within(help).getByRole('button', { name: 'Close' })).toHaveFocus()
    act(() => simulateDialogCancel(help))
    expect(screen.getByRole('button', { name: 'Settings' })).toBeEnabled()
    expect(select).toBeEnabled()
    await user.selectOptions(select, 'session-1')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveValue('Checkout session'))
    expect(select).toHaveValue('session-1')
    expect(api.createSession).not.toHaveBeenCalled()
  })

  it('creates exactly one blank ordinary Session only after explicit Start', async () => {
    api.listRecentSessions.mockResolvedValueOnce([])
    api.createEntry.mockResolvedValueOnce({ id: 'blank-note', sessionId: 'session-2', body: '', bodyJson: null, bodyFormat: 'html' })
    const pending = deferred<ReturnType<typeof sessionFixture>>()
    api.createSession.mockReturnValueOnce(pending.promise)
    render(<Workspace />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start a Session' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Explore an example' }))
    expect(api.createSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Start your own Session' }))
    await waitFor(() => expect(api.createSession).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Start a Session' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Start a Session' }))
    await act(async () => { pending.resolve(sessionFixture({ id: 'session-2', title: 'Untitled session 1' })); await pending.promise })
    await screen.findByRole('textbox', { name: 'Session title' })
    expect(api.createSession.mock.calls).toEqual([[{ title: 'Untitled session 1', sessionContext: null, objectiveNotes: null }]])
    expect(api.createEntry.mock.calls[0][0]).toMatchObject({ sessionId: 'session-2', entryType: 'note', body: '', metadataJson: null })
    expect(screen.getByLabelText('Note body')).toHaveTextContent('')
    expect(api.createFinding).not.toHaveBeenCalled()
    expect(api.importClipboardScreenshot).not.toHaveBeenCalled()
    expect(api.startAiActionJob).not.toHaveBeenCalled()
  })

  it('preserves dirty work when the existing new-Session save guard fails', async () => {
    api.listFindings.mockResolvedValueOnce([findingFixture()])
    api.updateFinding.mockRejectedValue(new Error('Disk full'))
    render(<Workspace />)
    await screen.findByRole('textbox', { name: 'Session title' })
    fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Finding title' }), { target: { value: 'Keep my unfinished Finding' } })
    await openExample()
    expect(api.updateFinding).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Start your own Session' }))
    await waitFor(() => expect(api.updateFinding).toHaveBeenCalled())
    expect(api.createSession).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Finding title' })).toHaveValue('Keep my unfinished Finding')
    expect(screen.getByRole('tab', { name: /Findings/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('copies only the feedback URL on explicit request, keeps navigation, and shows a manual fallback on failure', async () => {
    const user = userEvent.setup()
    const clipboard = vi.fn().mockRejectedValueOnce(new Error('Denied')).mockResolvedValueOnce(undefined)
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText: clipboard } as unknown as Clipboard)
    const upload = vi.fn()
    vi.stubGlobal('fetch', upload)
    const open = vi.spyOn(window, 'open')
    render(<Workspace />)
    await screen.findByRole('textbox', { name: 'Session title' })
    await waitFor(() => expect(window.location.hash).toBe('#/sessions/session-1'))
    const url = window.location.href
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByText('Send feedback'))
    expect(screen.getByRole('textbox', { name: 'Feedback URL' })).toHaveValue('https://github.com/ddv1982/qa-scribe/issues/new')
    expect(clipboard).not.toHaveBeenCalled()
    const copy = screen.getByRole('button', { name: 'Copy feedback link' })
    await user.click(copy)
    expect(within(screen.getByRole('dialog', { name: 'Help' })).getByRole('status')).toHaveTextContent('Could not copy. Select the URL and copy it manually.')
    await user.click(copy)
    expect(within(screen.getByRole('dialog', { name: 'Help' })).getByRole('status')).toHaveTextContent('Feedback link copied.')
    expect(clipboard.mock.calls).toEqual([['https://github.com/ddv1982/qa-scribe/issues/new'], ['https://github.com/ddv1982/qa-scribe/issues/new']])
    expect(window.location.href).toBe(url)
    expect(open).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })
})
