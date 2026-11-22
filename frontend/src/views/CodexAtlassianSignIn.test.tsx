import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { getCodexAtlassianStatus, signInCodexAtlassian, signOutCodexAtlassian } from '../tauri'
import { CodexAtlassianSignIn } from './CodexAtlassianSignIn'

vi.mock('../tauri', () => ({
  getCodexAtlassianStatus: vi.fn(),
  signInCodexAtlassian: vi.fn(),
  signOutCodexAtlassian: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('signs in, then offers sign-out', async () => {
  const user = userEvent.setup()
  vi.mocked(getCodexAtlassianStatus).mockResolvedValue('signedOut')
  let finishSignIn: (status: 'signedIn') => void = () => {}
  vi.mocked(signInCodexAtlassian).mockReturnValue(new Promise((resolve) => { finishSignIn = resolve }))
  vi.mocked(signOutCodexAtlassian).mockResolvedValue('signedOut')
  render(<CodexAtlassianSignIn />)

  expect(screen.getByRole('status').textContent).toBe('Checking…')
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not signed in'))
  await user.click(screen.getByRole('button', { name: 'Sign in for Codex' }))
  expect(screen.getByRole('status').textContent).toBe('Waiting for the browser sign-in…')
  expect(screen.getByRole('button', { name: 'Sign in for Codex' }).hasAttribute("disabled")).toBe(true)

  finishSignIn('signedIn')
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Signed in'))
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not signed in'))
  expect(signOutCodexAtlassian).toHaveBeenCalledOnce()
})

it('shows why a sign-in failed and lets you retry', async () => {
  const user = userEvent.setup()
  vi.mocked(getCodexAtlassianStatus).mockRejectedValue(new Error('Checking the Codex Atlassian sign-in failed: Codex CLI was not found.'))
  vi.mocked(signInCodexAtlassian).mockResolvedValue('signedIn')
  render(<CodexAtlassianSignIn />)

  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Codex CLI was not found'))
  await user.click(screen.getByRole('button', { name: 'Sign in for Codex' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Signed in'))
})
