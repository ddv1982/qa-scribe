import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { RefinementProposal } from '../bindings'
// The harness installs the Tauri mocks, so it loads before AppShell and its command imports.
import { cleanupControllerTest, getTauriMock, sessionNoteStateFixture, setupControllerTest, renderWithControllerStartup, useAppController } from './useAppController.testHarness'
import { entryFixture } from '../test/fixtures'
import { noteTooLongReason } from './useNoteProposalControls'
import { AppShell } from './AppShell'
import { completedChatFixture } from './useSessionChat.testSupport'

const api = getTauriMock()
function Subject() { return <AppShell {...useAppController()} /> }
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

const doc = (text: string) => JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [] } })
const proposal = (state: RefinementProposal['state']): RefinementProposal => ({
  version: 1, id: 'proposal-1', userMessageId: 'message-1', assistantMessageId: 'message-2', target: { kind: 'session' },
  patch: { kind: 'note', bodyMarkdown: 'Rewritten note 5512' },
  before: { title: 'Session Note', documentJson: doc(''), metadataJson: null, recordKind: 'note' },
  after: { title: 'Session Note', documentJson: doc('Rewritten note 5512'), metadataJson: null, recordKind: 'note' },
  state,
})

it('applies a suggested Note with Update note and restores the previous Note with Undo', async () => {
  const offered = completedChatFixture({ proposals: [proposal({ kind: 'offered' })] })
  api.getChat.mockResolvedValue(offered)
  api.resolveRefinement.mockImplementation(async () => {
    const applied = completedChatFixture({ revision: 4, proposals: [proposal({ kind: 'applied' })] })
    api.getChat.mockResolvedValue(applied)
    return applied
  })
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  const panel = within(screen.getByRole('complementary', { name: 'Notes AI chat' }))
  const suggestion = await panel.findByRole('region', { name: 'Suggested note' })
  expect(suggestion).toHaveTextContent('Rewritten note 5512')
  const note = screen.getByLabelText('Note body')
  const original = note.textContent
  expect(original).not.toContain('Rewritten note 5512')

  fireEvent.click(within(suggestion).getByRole('button', { name: 'Update note' }))
  await waitFor(() => expect(note).toHaveTextContent('Rewritten note 5512'))
  expect(api.resolveRefinement).toHaveBeenCalledWith({ scope: { sessionId: 'session-1', draftId: offered.draftId, expectedRevision: 3 }, proposalId: 'proposal-1', action: 'stage' })
  expect(panel.getByText('Note updated')).toBeVisible()

  fireEvent.click(panel.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(note.textContent).toBe(original))
  expect(panel.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
})

it('refuses to replace a Note too long for the AI to have read in full', async () => {
  api.getChat.mockResolvedValue(completedChatFixture({ proposals: [proposal({ kind: 'offered' })] }))
  api.openSessionNoteState.mockResolvedValue(sessionNoteStateFixture({ noteEntry: entryFixture({ body: `<p>${'Long observation. '.repeat(1000)}</p>` }) }))
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  const panel = within(screen.getByRole('complementary', { name: 'Notes AI chat' }))
  const suggestion = await panel.findByRole('region', { name: 'Suggested note' })
  fireEvent.click(within(suggestion).getByRole('button', { name: 'Update note' }))
  expect(await within(suggestion).findByRole('alert')).toHaveTextContent(noteTooLongReason)
  expect(api.resolveRefinement).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Note body')).not.toHaveTextContent('Rewritten note 5512')
})
