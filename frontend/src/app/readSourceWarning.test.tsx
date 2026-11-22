import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StatusPill } from '../components/Common'
import { entryFixture, generationStatusFixture } from '../test/fixtures'
import { readSourceWarning } from './readSourceWarning'
import { useWorkflowFeedback } from './useWorkflowFeedback'
import { cleanupControllerTest, getTauriMock, renderWithControllerStartup, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('readSourceWarning', () => {
  it('says nothing when every source was available', () => {
    expect(readSourceWarning([])).toBeNull()
    expect(readSourceWarning(undefined)).toBeNull()
  })

  it('names the cause once per connector', () => {
    expect(readSourceWarning([
      { source: 'jira', reason: 'needsSignIn' },
      { source: 'confluence', reason: 'needsSignIn' },
      { source: 'teamsChats', reason: 'connectorMissing' },
    ])).toBe("Couldn't look up Jira and Confluence: the Atlassian connector needs you to sign in again in Claude Code."
      + " Couldn't look up Teams chats: the Microsoft 365 connector isn't on in Claude Code.")
  })

  it('separates a partial tool set from a connector that did not connect', () => {
    expect(readSourceWarning([
      { source: 'jira', reason: 'toolsMissing' },
      { source: 'teamsChannels', reason: 'notConnected' },
    ])).toBe("Some lookups in Jira weren't available."
      + " Couldn't look up Teams channels: the Microsoft 365 connector wasn't connected in Claude Code when the run started.")
  })

  it('keeps a warning until the next notice replaces it', () => {
    const { result } = renderHook(() => useWorkflowFeedback())
    act(() => result.current.setNotice('Note summarized'))
    act(() => result.current.setWarning("Some lookups in Jira weren't available."))
    expect(result.current.notice).toEqual({ warning: "Some lookups in Jira weren't available." })
    act(() => result.current.setError('Failed'))
    expect(result.current.notice).toEqual({ warning: "Some lookups in Jira weren't available." })
    act(() => result.current.setNotice('Generating testware'))
    expect(result.current.notice).toBe('Generating testware')
  })

  it('renders a warning notice in the warning tone', () => {
    render(<StatusPill notice={{ warning: 'Some lookups in Jira weren\'t available.' }} error={null} busyAction={null} />)
    expect(screen.getByRole('status').className).toContain('warning')
    expect(screen.getByRole('status').textContent).toBe("Some lookups in Jira weren't available.")
  })
})

describe('a Summarize run without its read source', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('keeps the summary and Undo, and shows the warning', async () => {
    mockSummaryWithoutJira()
    const { result } = await renderWithControllerStartup(() => renderHook(() => useAppController()))
    await act(async () => { await result.current.handleAiAction('summary') })

    await waitFor(() => expect(result.current.latestNoteGenerationUndo).not.toBeNull())
    expect(result.current.notice).toEqual({ warning: "Couldn't look up Jira: the Atlassian connector isn't on in Claude Code." })
  })

  it("keeps the warning after the Note's images are written back", async () => {
    const image = '<p><img data-attachment-id="attachment-1" src="qa-scribe-attachment://attachment-1" alt="Evidence"></p>'
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: `<p>Original Note.</p>${image}` }) }))
    tauriMock.updateEntry.mockImplementationOnce(async (_id: string, patch: { body: string }) => entryFixture({ body: patch.body }))
    mockSummaryWithoutJira()
    const { result } = await renderWithControllerStartup(() => renderHook(() => useAppController()))
    await act(async () => { await result.current.handleAiAction('summary') })

    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.notice).toEqual({ warning: "Couldn't look up Jira: the Atlassian connector isn't on in Claude Code." }))
  })
})

function mockSummaryWithoutJira() {
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      // Real job events arrive after the start call returns.
      setTimeout(() => onEvent({
        type: 'completed',
        job_id: 'job-summary',
        status: generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
        result: {
          generationContext: { id: 'context-summary', sessionId: 'session-1', createdAt: '2026-11-22T10:00:00.000Z' },
          aiRun: {
            id: 'run-summary', sessionId: 'session-1', generationContextId: 'context-summary',
            provider: 'claude_code', modelSelection: { kind: 'recorded', requested: { kind: 'default' }, reported: null }, reasoningEffort: null, promptVersion: 'summary-v1',
            status: 'completed', errorMessage: null, createdAt: '2026-11-22T10:00:00.000Z', completedAt: '2026-11-22T10:00:00.000Z',
          },
          draft: null,
          finding: null,
          noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }),
          unavailableReadSources: [{ source: 'jira', reason: 'connectorMissing' }],
        },
      }))
      return { jobId: 'job-summary', status: generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }) }
    })
}
