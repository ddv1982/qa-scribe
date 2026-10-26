import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AppShell } from './AppShell'
import { cleanupControllerTest, getTauriMock, setupControllerTest, renderWithControllerStartup, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
function Subject() { return <AppShell {...useAppController()} /> }
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it('keeps the Note editable beside its own Ask AI conversation and retains unsent input across close', async () => {
  await renderWithControllerStartup(() => render(<Subject />))
  expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
  const note = screen.getByLabelText('Note body')
  const trigger = screen.getByRole('button', { name: 'Ask AI' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  const panel = within(screen.getByRole('complementary', { name: 'Notes AI chat' }))
  expect(panel.getByRole('heading', { name: 'Ask AI' })).toBeVisible()
  expect(panel.getByRole('region', { name: 'Chat source' })).toHaveTextContent('Checkout session')
  expect(panel.queryByRole('heading', { name: 'Conversation' })).not.toBeInTheDocument()
  expect(note).toBeVisible()
  expect(note).toHaveAttribute('contenteditable', 'true')
  const input = panel.getByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: 'Keep this Notes question. 雪' } })
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(input).toHaveFocus()
  expect(input).toHaveValue('Keep this Notes question. 雪')
  fireEvent.click(panel.getByRole('button', { name: 'Close Ask AI' }))
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByLabelText('Note body')).toBe(note)
  fireEvent.click(trigger)
  expect(panel.getByRole('textbox', { name: 'Message' })).toBe(input)
  expect(input).toHaveValue('Keep this Notes question. 雪')
  fireEvent.click(panel.getByText('Conversation options'))
  expect(panel.getByRole('button', { name: 'Configure AI' })).toBeVisible()
  expect(panel.getByRole('button', { name: 'Start new conversation' })).toBeVisible()
  expect(api.beginRecordChat).not.toHaveBeenCalled()
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.submitChat).not.toHaveBeenCalled()
})
