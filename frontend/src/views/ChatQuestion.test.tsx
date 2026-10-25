import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatMessage, ChatTarget } from '../bindings'
import { ChatMessageList } from './ChatMessageList'
const target: ChatTarget = { kind: 'finding', snapshot: { sessionId: 's', recordId: 'f', title: 'Source finding', documentJson: '', metadataJson: null, recordKind: 'bug', origin: 'unsaved_editor', localFingerprint: '', storedBaseToken: '' } }
const user: ChatMessage = { id: 'u', turnId: 't', role: 'user', text: 'Draft', context: target, images: [], status: 'completed', errorMessage: null, aiRunId: null, createdAt: '' }
const message: ChatMessage = { ...user, id: 'a', role: 'assistant', text: 'Draft content first.', response: { sourceUserMessageId: 'u', purpose: { kind: 'jira_drafting' }, question: { prompt: 'Which configured type?', choices: ['Finding subtask', 'Other custom type', '<script>literal</script>'] }, warning: null } }
afterEach(cleanup)
it('renders every visible choice and keeps the separate Recommended badge out of its payload', () => {
  const onAnswer = vi.fn(async () => {})
  render(<ChatMessageList messages={[user, message]} aiRuns={[]} questionControls={{ target: { kind: 'finding', recordId: 'f', title: 'Source finding', unsaved: true }, blockedReason: '', onAnswer }} />)
  expect(screen.getByText('Recommended')).toBeInTheDocument()
  expect(screen.getByText('Other custom type')).toBeInTheDocument()
  expect(screen.getByText('<script>literal</script>')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Finding subtask' }))
  expect(onAnswer.mock.calls[0]).toEqual(['a', 'Finding subtask'])
  expect(screen.getByRole('button', { name: 'Finding subtask' })).not.toHaveAttribute('aria-pressed')
})
it('keeps historical and mismatched questions readable and inactive with their original source', () => {
  render(<ChatMessageList messages={[user, message]} aiRuns={[]} questionControls={{ target: { kind: 'session' }, blockedReason: '', onAnswer: vi.fn(async () => {}) }} />)
  expect(screen.getByRole('button', { name: 'Finding subtask' })).toBeDisabled()
  expect(screen.getByText(/Typed messages still use your current context/)).toBeInTheDocument()
  expect(screen.getAllByText(/Source finding/).length).toBeGreaterThan(0)
})
it('expires a question on any later failed user turn and shows no badge for Test cases', () => {
  const source = { ...user, context: { ...target, kind: 'test_cases_draft' } as ChatTarget }
  render(<ChatMessageList messages={[source, message, { ...user, id: 'later', status: 'failed' }]} aiRuns={[]} questionControls={{ target: { kind: 'test_cases_draft', recordId: 'f', title: 'Cases', unsaved: false }, blockedReason: '', onAnswer: vi.fn(async () => {}) }} />)
  expect(screen.getByRole('button', { name: 'Finding subtask' })).toBeDisabled()
  expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
})
it('saved review supplies no active callbacks and an invalid response never offers an action', () => {
  const onPrepareAction = vi.fn(async () => {})
  render(<ChatMessageList messages={[user, { ...message, response: { ...message.response!, question: null, warning: 'Response retained without controls.' } }]} aiRuns={[]} questionControls={{ target: { kind: 'session' }, blockedReason: '', onPrepareAction }} />)
  expect(screen.queryByRole('button', { name: 'Prepare action message' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Response retained without controls')
})
