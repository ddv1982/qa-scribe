import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { commands, type RefinementProposal } from '../bindings'
import { findingFixture } from '../test/fixtures'
import { editorValue } from '../app/recordWriteGuards'
import { chatFixture, chatJobFixture } from '../app/useSessionChat.testSupport'
import { ChatProposalReview } from './ChatProposalReview'
import { SessionChatView } from './SessionChatView.testSupport'

afterEach(cleanup)
function proposal(): RefinementProposal {
  const record = findingFixture({ metadataJson: '{"severity":"low","custom":{"private":"preserve"}}' })
  const before = editorValue(record)
  return { version: 1, id: 'proposal-1', userMessageId: 'user-1', assistantMessageId: 'assistant-1', target: { kind: 'finding', snapshot: { sessionId: record.sessionId, recordId: record.id, title: record.title, documentJson: before.documentJson, metadataJson: before.metadataJson, recordKind: record.kind, origin: 'saved', localFingerprint: 'local', storedBaseToken: 'stored' } }, patch: { kind: 'finding', title: 'Suggested title', bodyMarkdown: null, metadata: { severity: 'high', status: null, component: null, reference: null } }, before, after: { ...before, title: 'Suggested title', metadataJson: '{"severity":"high","custom":{"private":"preserve"}}' }, state: { kind: 'offered' } }
}

it('shows allowed field changes with labels and keeps preserved unknown metadata out of review', () => {
  const item = proposal()
  render(<ChatProposalReview proposal={item} controls={{ errors: { [item.id]: 'The editor changed. Your newer edits are retained.' }, pending: new Set(), onAction: vi.fn(async () => {}) }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Review refinement' }))
  expect(screen.getByLabelText('Suggested finding field changes')).toHaveTextContent('SeverityLow severity to High severity')
  expect(screen.getByLabelText('Before refinement')).toHaveTextContent(item.before.title)
  expect(screen.getByLabelText('After refinement')).toHaveTextContent('Suggested title')
  expect(screen.queryByText(/custom|private|metadataJson/)).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Your newer edits are retained')
  expect(screen.getByRole('button', { name: 'Apply to editor' })).toBeEnabled()
})

function view(chat = chatFixture(), error: string | null = null, refinementStarting = false) {
  return render(<SessionChatView chat={chat} responseStarting={refinementStarting ? { kind: 'refine_record' } : undefined} composer="Retained input" job={chatJobFixture({ partialText: '{"version":1,"requestId":"internal-contract"' })}
    loading={false} saving={false} working error={error} providerLabel="Codex" modelLabel="CLI default" providerAvailable providerReason=""
    onSetComposer={vi.fn()} onSend={vi.fn(async () => {})} onRetry={vi.fn(async () => {})} onCancel={vi.fn(async () => {})}
    onSubmit={vi.fn(async () => {})} onRestart={vi.fn(async () => {})} onConfigureAi={vi.fn()} />)
}

it('hides contracted JSON while preparing and retains Cancel and the composer', () => {
  view(chatFixture({ pendingResponse: { kind: 'refinement', recordKind: 'finding' } }))
  expect(screen.getByRole('heading', { name: 'Preparing suggested changes' })).toBeInTheDocument()
  expect(screen.queryByText(/internal-contract|requestId/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel response' })).toBeEnabled()
  expect(screen.getByLabelText('Message')).toHaveValue('Retained input')
})

it('keeps one non-permission error alert inside the composer', () => {
  const { container } = view(chatFixture(), 'This provider does not accept images. Your input is retained.')
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(container.querySelector('.chat-composer [role="alert"]')).toHaveTextContent('does not accept images')
  expect(screen.getByLabelText('Message')).toHaveValue('Retained input')
})

it('hides refinement protocol output before the started chat snapshot is hydrated', () => {
  view(chatFixture(), null, true)
  expect(screen.getByRole('heading', { name: 'Preparing suggested changes' })).toBeInTheDocument()
  expect(screen.queryByText(/internal-contract|requestId/)).not.toBeInTheDocument()
})

it('shows every record patch field and Update without a second review step', () => {
  const item = proposal()
  item.after = { ...item.after, metadataJson: '{"severity":"high","status":"resolved","component":"Checkout","reference":"DEMO-9"}' }
  render(<ChatProposalReview presentation="record" proposal={item} controls={{ pending: new Set(), errors: {}, onAction: vi.fn(async () => {}) }} />)
  expect(screen.getByText('Suggested title')).toBeInTheDocument()
  expect(screen.getByLabelText('Suggested finding field changes')).toHaveTextContent('SeverityLow severity to High severityStatusOpen to ResolvedComponentNot set to CheckoutReferenceNot set to DEMO-9')
  expect(screen.getByRole('button', { name: 'Update finding' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Review refinement' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Before refinement')).not.toBeInTheDocument()
})

it('announces a pending Notes turn as a reply, since it may answer or rewrite the Note', () => {
  view(chatFixture({ pendingResponse: { kind: 'refinement', recordKind: 'note' } }))
  expect(screen.getByRole('heading', { name: 'Preparing reply' })).toBeInTheDocument()
  expect(screen.queryByText(/internal-contract|requestId/)).not.toBeInTheDocument()
})

it('keeps the reviewed image on conversation refresh and labels the outgoing image as a replacement', async () => {
  const reference = { sessionId: 'session-1', draftId: 'chat-1' }
  const read = vi.spyOn(commands, 'reviewVisualRefinement').mockResolvedValue({
    source: 'data:image/png;base64,AA==',
    replaced: 'data:image/png;base64,BB==',
  })
  const item = { ...proposal(), patch: { kind: 'test_cases_visual', visual: {
    target: [0], caption: 'Checkout evidence', action: { kind: 'place', replace: true, source: { kind: 'chat', index: 0 } },
  } } } satisfies RefinementProposal
  try {
    const { rerender } = render(<ChatProposalReview proposal={item} reference={reference} />)
    expect(await screen.findByAltText('Checkout evidence')).toBeInTheDocument()
    expect(screen.getByText('Will replace')).toBeInTheDocument()
    await act(async () => {
      rerender(<ChatProposalReview proposal={{ ...item, patch: { ...item.patch, visual: { ...item.patch.visual } } }} reference={{ ...reference }} />)
    })
    expect(read).toHaveBeenCalledExactlyOnceWith(reference, item.id)
  } finally {
    read.mockRestore()
  }
})
