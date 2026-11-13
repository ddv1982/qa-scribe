import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// The harness mocks the Tauri bridge, so it loads before the views that read test runs through it.
import { cleanupControllerTest, getTauriMock, renderWithControllerStartup, setupControllerTest, useAppController } from './useAppController.testHarness'
import type { BeginTestRunChatRequest, ChatRef, ChatState, RefinementProposal, TestRun, TestRunSummary } from '../bindings'
import { draftFixture } from '../test/fixtures'
import { formatDateTime } from '../ui/format'
import { AppShell } from './AppShell'
import { presentRun, type ShownTestRun } from './conversationPresentation'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'

const api = getTauriMock()
function Subject() { return <AppShell {...useAppController()} /> }

const at = '2026-11-13T09:30:00Z'
const runnable = '<h2>Checkout</h2><h3>Pay by card</h3><p>Order is placed.</p><h3>Pay with a gift card</h3><p>Gift card is charged.</p>'
const drafts = [
  draftFixture({ id: 'draft-1', title: 'Checkout test cases', body: runnable }),
  draftFixture({ id: 'draft-2', title: 'Refund test cases', body: runnable, updatedAt: '2000-01-01T00:00:00Z' }),
]
function run(id: string, createdAt = at): TestRun {
  return { id, sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout test cases', createdAt, updatedAt: createdAt,
    cases: [{ id: `${id}-case`, runId: id, position: 0, groupTitle: 'Checkout', title: 'Pay by card', bodyJson: '{"type":"doc","content":[]}', result: 'failed', remark: 'Declined', findingId: null, findingTitle: null, updatedAt: createdAt }] }
}
function summary(source: TestRun): TestRunSummary {
  return { id: source.id, sessionId: source.sessionId, draftId: source.draftId, draftTitle: source.draftTitle, createdAt: source.createdAt, updatedAt: source.updatedAt,
    total: 1, passed: 0, failed: 1, blocked: 0, notRun: 0 }
}
const newer = run('run-2', '2026-11-13T11:00:00Z')
const older = run('run-1')

beforeEach(() => {
  setupControllerTest()
  api.listDrafts.mockResolvedValue(drafts)
  api.listTestRuns.mockResolvedValue([summary(newer), summary(older)])
  api.getTestRun.mockImplementation(async (runId: string) => runId === newer.id ? newer : older)
})
afterEach(cleanupControllerTest)

async function openRun() {
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('tab', { name: /Test cases/ }))
  fireEvent.click(await screen.findByRole('button', { name: /^Last test run/ }))
  await screen.findByRole('button', { name: 'Copy report' })
}

function trigger() {
  return within(screen.getByRole('article')).getByRole('button', { name: 'Ask AI' })
}

async function askAi() {
  fireEvent.click(trigger())
  const input = await screen.findByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).toBeEnabled())
  return input
}

describe('Ask AI on a test run', () => {
  it('opens a read-only conversation about the run beside it and focuses the composer again on a second click', async () => {
    await openRun()
    const actions = [...screen.getByRole('article').querySelectorAll('.test-run-actions > button')].map(button => button.textContent)
    expect(actions.slice(0, 2)).toEqual(['Ask AI', 'Copy report'])
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    const input = await askAi()
    expect(api.beginTestRunChat).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1', runId: newer.id }))
    expect(api.beginRecordChat).not.toHaveBeenCalled()
    expect(input).toHaveFocus()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    const source = screen.getByRole('region', { name: 'Chat source' })
    expect(source).toHaveTextContent('Test run')
    expect(source).toHaveTextContent(`Checkout test cases, ${formatDateTime(newer.createdAt)}`)
    const panel = screen.getByRole('complementary', { name: 'Ask AI' })
    expect(within(panel).getByText('Ask about this test run, or ask to post its results somewhere. Results cannot be changed from here.')).toBeInTheDocument()
    expect(within(panel).queryByRole('heading', { name: /Improve this/ })).not.toBeInTheDocument()
    expect(within(panel).queryByText('You can also ask to add it to Jira.')).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'Post the results to PAY-12' } })
    input.blur()
    fireEvent.click(trigger())
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByRole('textbox', { name: 'Message' })).toBe(input)
    expect(input).toHaveValue('Post the results to PAY-12')
    expect(api.beginTestRunChat).toHaveBeenCalledTimes(1)
  })

  it('shows no proposal for the run and labels each message with the test run', async () => {
    const value = { title: 'Checkout test cases', documentJson: '{"schemaVersion":1,"doc":{"type":"doc","content":[]}}', metadataJson: null, recordKind: 'testware' }
    // A proposal the backend never creates for a run; the panel must not offer it even if one arrived.
    const proposal: RefinementProposal = { version: 1, id: 'proposal-1', userMessageId: 'user-1', assistantMessageId: 'assistant-1',
      target: { kind: 'test_cases_draft', snapshot: { sessionId: 'session-1', recordId: 'draft-1', title: value.title, documentJson: value.documentJson, metadataJson: null, recordKind: 'testware', origin: 'saved', localFingerprint: '', storedBaseToken: '' } },
      patch: { kind: 'test_cases_draft', title: 'Rewritten', bodyMarkdown: null }, before: value, after: { ...value, title: 'Rewritten' }, state: { kind: 'offered' } }
    const chats = new Map<string, ChatState>()
    const fallback = api.getConversation.getMockImplementation()!
    api.getConversation.mockImplementation(async reference => chats.get(reference.draftId) ?? fallback(reference))
    api.beginTestRunChat.mockImplementation(async (request: BeginTestRunChatRequest) => {
      const chat = chatFixture({
        sessionId: request.sessionId, draftId: request.draftId, mode: 'chat', owner: { kind: 'test_run', sessionId: request.sessionId, runId: request.runId }, proposals: [proposal],
        messages: [
          { id: 'user-1', turnId: 'turn-1', role: 'user', text: 'Summarize the run', images: [], status: 'completed', errorMessage: null, aiRunId: null, createdAt: at, context: { kind: 'session' } },
          { id: 'assistant-1', turnId: 'turn-1', role: 'assistant', text: 'One case failed.', images: [], status: 'completed', errorMessage: null, aiRunId: null, createdAt: at },
        ],
      })
      chats.set(chat.draftId, chat)
      return chat
    })
    await openRun()
    await askAi()
    const panel = screen.getByRole('complementary', { name: 'Ask AI' })
    expect(within(panel).getByText('One case failed.')).toBeInTheDocument()
    expect(within(panel).getByText('Test run', { selector: '.chat-context-label' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /^Update|Review refinement|Apply to editor/ })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('region', { name: /Suggested changes/ })).not.toBeInTheDocument()
    expect(within(panel).queryByText('Rewritten')).not.toBeInTheDocument()
  })

  it.each([
    ['going back to the test cases', () => fireEvent.click(screen.getByRole('button', { name: 'Back to test cases' }))],
    ['switching to another run', () => fireEvent.change(screen.getByRole('combobox', { name: 'Test run' }), { target: { value: older.id } })],
    ['switching to another draft', () => fireEvent.click(within(screen.getByRole('complementary', { name: 'Test cases records' })).getByRole('button', { name: /Refund test cases/ }))],
    ['leaving the Test cases tab', () => fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))],
  ])('closes the panel when %s', async (_label, leave) => {
    await openRun()
    await askAi()
    expect(screen.getByRole('complementary', { name: 'Ask AI' })).toBeVisible()
    leave()
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument())
  })

  it('starts fresh after a settled close', async () => {
    await openRun()
    await askAi()
    fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument())
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    await askAi()
    expect(api.beginTestRunChat).toHaveBeenCalledTimes(2)
    const [first, second] = (api.beginTestRunChat.mock.calls as [BeginTestRunChatRequest][]).map(([request]) => request.draftId)
    expect(second).not.toBe(first)
  })
})

describe('the source line of a test run', () => {
  const owner = { kind: 'test_run' as const, sessionId: 'session-1', runId: 'run-1' }
  const shown = (patch: Partial<ShownTestRun> = {}): ShownTestRun => ({ sessionId: 'session-1', runId: 'run-1', draftTitle: 'Checkout', createdAt: at, error: null, retry: () => undefined, ...patch })

  it('names the run by draft title and start while its screen shows it', () => {
    expect(presentRun(owner, shown())).toEqual({ kind: 'available', title: `Checkout, ${formatDateTime(at)}`, unsaved: false })
    expect(presentRun(owner, shown({ draftTitle: null, createdAt: null }))).toEqual({ kind: 'loading' })
    expect(presentRun(owner, shown({ error: 'Not found' }))).toEqual({ kind: 'error', message: 'Not found' })
  })

  it('is unavailable once the run is no longer on screen, as after it was deleted', () => {
    expect(presentRun(owner, null)).toEqual({ kind: 'unavailable' })
    expect(presentRun(owner, shown({ runId: 'run-2' }))).toEqual({ kind: 'unavailable' })
    expect(presentRun(owner, shown({ sessionId: 'session-2' }))).toEqual({ kind: 'unavailable' })
  })
})

describe('an unfinished conversation of a deleted test run', () => {
  const reference = { sessionId: 'session-1', draftId: 'run-chat-unfinished' }
  const owner = { kind: 'test_run' as const, sessionId: 'session-1', runId: 'run-deleted' }
  const message = { id: 'run-user', turnId: 'run-turn', role: 'user' as const, text: 'Post the results to PAY-12', images: [], status: 'running' as const, errorMessage: null, aiRunId: 'run-chat', createdAt: at }
  const row = chatFixture({ ...reference, owner, mode: 'chat', lastActiveOrder: 5, messages: [message] })
  const job = chatJobFixture({ chat: { reference }, progressMessage: 'Waiting for tool permission', partialText: null, pendingPermission: {
    requestId: 'permission-run', provider: 'codex_cli', title: 'Comment on PAY-12?', toolName: 'add_comment', serverName: 'jira', inputJson: '{"issue":"PAY-12"}' } })
  const history = (lastTurnStatus: 'running' | 'completed') => [{ reference, owner, createdAt: '', lastActiveAt: '', lastActiveOrder: 5, preview: '', archived: false, submission: null, hasContent: true, lastTurnStatus, unresolvedStages: [] }]

  beforeEach(() => {
    const fallback = api.getConversation.getMockImplementation()!
    api.getConversation.mockImplementation(async (ref: ChatRef) => ref.draftId === reference.draftId ? row : fallback(ref))
    api.listActiveAiActionJobs.mockResolvedValue([job])
    api.getAiActionJobStatus.mockResolvedValue(job)
  })

  it('is recovered from the Session bar into an unavailable-source panel that keeps Stop and the permission prompt', async () => {
    api.listTestRuns.mockResolvedValue([summary(newer)])
    api.listChatHistory.mockResolvedValue(history('running'))
    await renderWithControllerStartup(() => render(<Subject />))
    fireEvent.click(await screen.findByRole('button', { name: 'Recover Ask AI · Deleted test run' }))
    const panel = await screen.findByRole('complementary', { name: 'Ask AI' })
    expect(screen.getByRole('tab', { name: /Test cases/ })).toHaveAttribute('aria-selected', 'true')
    const source = within(panel).getByRole('region', { name: 'Chat source' })
    expect(source).toHaveTextContent('Test run')
    expect(source).toHaveTextContent('This test run is no longer available.')
    expect(within(panel).getByText('Post the results to PAY-12')).toBeInTheDocument()
    expect(await within(panel).findByRole('button', { name: 'Approve once' })).toBeEnabled()
    expect(within(panel).getByRole('button', { name: 'Deny' })).toBeEnabled()
    expect(within(panel).getByRole('button', { name: 'Stop' })).toBeEnabled()
    expect(within(panel).getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('is not listed while its run still exists, or once the conversation is finished', async () => {
    api.listTestRuns.mockResolvedValue([summary(newer), { ...summary(older), id: 'run-deleted' }])
    api.listChatHistory.mockResolvedValue(history('running'))
    const { unmount } = await renderWithControllerStartup(() => render(<Subject />))
    await waitFor(() => expect(api.listTestRuns).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Recover Ask AI/ })).not.toBeInTheDocument()
    unmount()

    api.listTestRuns.mockResolvedValue([])
    api.listActiveAiActionJobs.mockResolvedValue([])
    api.listChatHistory.mockResolvedValue(history('completed'))
    await renderWithControllerStartup(() => render(<Subject />))
    await waitFor(() => expect(api.listChatHistory).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Recover Ask AI/ })).not.toBeInTheDocument()
  })
})
