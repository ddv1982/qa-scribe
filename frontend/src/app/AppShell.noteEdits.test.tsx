import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RefinementProposal } from '../bindings'
// The harness installs the Tauri mocks, so it loads before AppShell and its command imports.
import { sessionNoteStateFixture, cleanupControllerTest, getTauriMock, setupControllerTest, renderWithControllerStartup, useAppController } from './useAppController.testHarness'
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
  api.applyNoteRefinement.mockImplementation(async ({ undo }) => {
    const chat = completedChatFixture({ revision: undo ? 5 : 4, proposals: [proposal({ kind: undo ? 'offered' : 'note_applied' })] })
    api.getChat.mockResolvedValue(chat)
    const original = sessionNoteStateFixture().noteEntry
    return { chat, note: undo ? original : { ...original, body: '<p>Rewritten note 5512</p>', bodyJson: doc('Rewritten note 5512'), bodyFormat: 'tiptap_json' } }
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
  expect(api.applyNoteRefinement).toHaveBeenCalledWith({ reference: { sessionId: 'session-1', draftId: offered.draftId }, proposalId: 'proposal-1', undo: false })
  expect(panel.getByText('Note updated')).toBeVisible()

  fireEvent.click(panel.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(note.textContent).toBe(original))
  expect(panel.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
})

it('restores the previous Note when the update cannot be recorded', async () => {
  api.getChat.mockResolvedValue(completedChatFixture({ proposals: [proposal({ kind: 'offered' })] }))
  api.applyNoteRefinement.mockRejectedValue(new Error('Chat changed. Reload the conversation before retrying.'))
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  const panel = within(screen.getByRole('complementary', { name: 'Notes AI chat' }))
  const suggestion = await panel.findByRole('region', { name: 'Suggested note' })
  const note = screen.getByLabelText('Note body')
  const original = note.textContent
  fireEvent.click(within(suggestion).getByRole('button', { name: 'Update note' }))
  expect(await within(suggestion).findByRole('alert')).toHaveTextContent('Chat changed')
  await waitFor(() => expect(note.textContent).toBe(original))
})


it('offers regeneration for an older suggestion without exposing Update note', async () => {
  const { ChatProposalReview } = await import('../views/ChatProposalReview')
  const regenerate = vi.fn(async () => {})
  render(<ChatProposalReview proposal={proposal({ kind: 'offered' })} noteSourceNeedsRefresh onRegenerate={regenerate}
    controls={{ errors: {}, pending: new Set(), onUpdate: vi.fn(), onAction: vi.fn() }} />)
  expect(screen.queryByRole('button', { name: 'Update note' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate suggestion' }))
  expect(regenerate).toHaveBeenCalledTimes(1)
})
