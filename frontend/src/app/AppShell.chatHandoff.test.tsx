import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { completedChatFixture, chatFixture } from './useSessionChat.testSupport'
import { entryFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { cleanupControllerTest, getTauriMock, sessionNoteStateFixture, setupControllerTest, renderWithControllerStartup, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
const receipt = { draftId: 'chat-1', noteId: 'entry-1', submittedAt: 'saved' }
function Subject() { return <AppShell {...useAppController()} /> }
beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it('reviews without writes, adds once, opens the actual updated Note, and restarts from Note with cancel/accept', async () => {
  let chat = completedChatFixture()
  api.getChat.mockImplementation(async () => chat)
  const canonical = entryFixture(richEditorDocumentToStoredBody(richEditorDocumentFromPlainText(
    'Existing Note\nUser: Payment failed\nAssistant: Which build?',
  )))
  api.submitChat.mockImplementation(async () => {
    chat = completedChatFixture({ submission: receipt, mode: 'write_note', revision: 4 })
    api.openSessionNoteState.mockResolvedValue(sessionNoteStateFixture({ noteEntry: canonical }))
    return receipt
  })
  api.restartChat.mockImplementation(async () => {
    chat = chatFixture({ draftId: 'chat-next', mode: 'chat' })
    return chat
  })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await renderWithControllerStartup(() => render(<Subject />))
  expect(screen.getByRole('button', { name: 'Review saved conversation' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Review saved conversation' }))
  expect(screen.getByRole('region', { name: 'Saved conversation' })).toHaveTextContent('Which build?')
  fireEvent.click(screen.getByRole('button', { name: 'Review saved conversation' }))
  expect(api.updateEntry).not.toHaveBeenCalled()
  expect(api.submitChat).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Add conversation to note' }))
  await waitFor(() => expect(screen.getByLabelText('Conversation added')).toBeVisible())
  expect(screen.getByRole('button', { name: 'Write note' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByLabelText('Note body')).toHaveTextContent('Existing Note')
  expect(screen.getByLabelText('Note body')).toHaveTextContent('Assistant: Which build?')
  expect(confirm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open updated Note' })).toBeVisible())
  fireEvent.click(screen.getByRole('button', { name: 'Open updated Note' }))
  expect(screen.getByLabelText('Note body')).toHaveTextContent('Assistant: Which build?')
  fireEvent.click(screen.getByRole('button', { name: 'Start new conversation' }))
  expect(api.restartChat).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Start new conversation' }))
  await waitFor(() => expect(api.restartChat).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled())
  expect(screen.getByRole('region', { name: 'Conversation transcript' })).toHaveTextContent('No messages yet')
  fireEvent.click(screen.getByRole('button', { name: 'Write note' }))
  expect(screen.getByLabelText('Note body')).toHaveTextContent('Assistant: Which build?')
  expect(api.submitChat).toHaveBeenCalledTimes(1)
  expect(api.updateEntry).not.toHaveBeenCalled()
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.startAiActionJob).not.toHaveBeenCalled()
})
