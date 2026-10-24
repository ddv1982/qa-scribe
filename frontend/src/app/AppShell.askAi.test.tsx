import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AppShell } from './AppShell'
import { findingFixture } from '../test/fixtures'
import { cleanupControllerTest, getTauriMock, setupControllerTest, renderWithControllerStartup, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
function Subject() { return <AppShell {...useAppController()} /> }
beforeEach(() => { setupControllerTest(); api.listFindings.mockResolvedValue([findingFixture()]) })
afterEach(cleanupControllerTest)

it('opens Ask AI beside the existing saved record and keeps the same composer DOM through close, expand and Notes', async () => {
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
  await screen.findByRole('button', { name: 'Ask AI' })
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  const input = screen.getByRole('textbox', { name: 'Message' })
  expect(input).toHaveFocus()
  expect(screen.getByRole('region', { name: 'Chat context' })).toHaveTextContent('Saved record')
  fireEvent.change(input, { target: { value: 'Unsent tester question' } })
  const transcript = screen.getByRole('region', { name: 'Conversation and actions' })
  transcript.scrollTop = 42
  fireEvent.click(screen.getByRole('button', { name: 'Expand AI chat' }))
  fireEvent.click(screen.getByRole('button', { name: 'Collapse AI chat' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close AI chat' }))
  expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(input)
  expect(input).toHaveValue('Unsent tester question')
  expect(transcript.scrollTop).toBe(42)
  fireEvent.click(screen.getByRole('tab', { name: 'Note' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Chat' }))
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(input)
  expect(input).toHaveValue('Unsent tester question')
  expect(screen.getByRole('region', { name: 'Chat context' })).toHaveTextContent('Session context')
  expect(api.updateFinding).not.toHaveBeenCalled()
})

it('shows unsaved record context and detach leaves the editor content intact', async () => {
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
  await screen.findByRole('button', { name: 'Ask AI' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Finding title' }), { target: { value: 'Unsaved checkout title' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Chat context' })).toHaveTextContent('Unsaved edits included'))
  fireEvent.click(screen.getByRole('button', { name: 'Detach record context' }))
  expect(screen.getByRole('region', { name: 'Chat context' })).toHaveTextContent('No record attached')
  expect(screen.getByRole('textbox', { name: 'Finding title' })).toHaveValue('Unsaved checkout title')
  expect(api.updateFinding).not.toHaveBeenCalled()
})
