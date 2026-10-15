import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider, ChatMessage, ChatPermissionDecision, ChatPermissionRequest, ChatState, GenerationJobStatus } from '../bindings'
import { SessionChatView, type SessionChatViewProps } from './SessionChatView'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function chat(messages: ChatMessage[] = []): ChatState {
  return { sessionId: 'session-1', draftId: 'chat-1', revision: 1, composer: '', mode: 'chat', messages, submission: null }
}

function permission(patch: Partial<ChatPermissionRequest> = {}): ChatPermissionRequest {
  return {
    requestId: 'opaque-request-token', provider: 'codex_cli', title: 'Read the selected testing resource?',
    toolName: 'read_resource', serverName: 'qa-mcp', inputJson: '{"resource":"test-plan"}', ...patch,
  }
}

function job(patch: Partial<GenerationJobStatus> = {}): GenerationJobStatus {
  return {
    jobId: 'job-1', sessionId: 'session-1', action: 'chat', state: 'running',
    progressMessage: 'Waiting for tool permission', aiRunId: null, errorMessage: null,
    partialText: null, pendingPermission: permission(), ...patch,
  }
}

function mount(patch: Partial<SessionChatViewProps> = {}) {
  const props: SessionChatViewProps = {
    chat: chat(), composer: '', job: job(), loading: false, saving: false, working: true,
    permissionWorking: false, error: null, providerLabel: 'Currently selected provider',
    modelLabel: 'Provider default', providerAvailable: true, providerReason: '',
    onSetComposer: vi.fn(), onSend: vi.fn(async () => {}), onRetry: vi.fn(async () => {}),
    onCancel: vi.fn(async () => {}), onSubmit: vi.fn(async () => {}), onRestart: vi.fn(async () => {}),
    onConfigureAi: vi.fn(), onDecidePermission: vi.fn(async () => {}), onRecheck: vi.fn(async () => {}),
    ...patch,
  }
  return { props, ...render(<SessionChatView {...props} />) }
}

const panel = () => screen.getByRole('region', { name: 'Tool permission' })
const choice = (name: string) => within(panel()).getByRole('button', { name })
const noPanel = () => expect(screen.queryByRole('region', { name: 'Tool permission' })).not.toBeInTheDocument()

describe('SessionChatView tool permission contract (F4auth-ui)', () => {
  it('shows an accessible backend permission request with exact structured identity and one-call scope', () => {
    mount()
    expect(within(panel()).getByRole('heading')).toBeInTheDocument()
    expect(within(panel()).getByText('Read the selected testing resource?')).toBeInTheDocument()
    expect(within(panel()).getByText('read_resource', { exact: true })).toBeInTheDocument()
    expect(within(panel()).getByText('qa-mcp', { exact: true })).toBeInTheDocument()
    expect(within(panel()).getByText('{"resource":"test-plan"}', { exact: true })).toBeInTheDocument()
    expect(within(panel()).getByText('This approval applies to this tool call only.')).toBeInTheDocument()
    expect(choice('Approve once')).toBeEnabled()
    expect(choice('Deny')).toBeEnabled()
    expect(screen.getAllByRole('button', { name: 'Cancel response' })).toHaveLength(1)
  })

  it.each([
    ['claude_code', 'Claude'], ['codex_cli', 'Codex'], ['copilot_cli', 'Copilot'],
  ] satisfies [AiProvider, string][])('uses the pending %s provider, not the currently selected label', (provider, label) => {
    mount({ job: job({ pendingPermission: permission({ provider }) }) })
    expect(panel()).toHaveTextContent(label)
    expect(panel()).not.toHaveTextContent('Currently selected provider')
  })

  it.each([
    ['Approve once', 'approve'], ['Deny', 'deny'],
  ] satisfies [string, ChatPermissionDecision][])('passes the exact request token for %s without starting a response', (name, decision) => {
    const { props } = mount()
    fireEvent.click(choice(name))
    expect(props.onDecidePermission).toHaveBeenCalledExactlyOnceWith('opaque-request-token', decision)
    expect(props.onSend).not.toHaveBeenCalled()
    expect(props.onRetry).not.toHaveBeenCalled()
  })

  it('blocks duplicate decisions while keeping the existing cancellation action enabled', () => {
    const { props, rerender } = mount()
    fireEvent.click(choice('Approve once'))
    rerender(<SessionChatView {...props} permissionWorking />)
    expect(choice('Approve once')).toBeDisabled()
    expect(choice('Deny')).toBeDisabled()
    fireEvent.click(choice('Approve once'))
    fireEvent.click(choice('Deny'))
    expect(props.onDecidePermission).toHaveBeenCalledTimes(1)
    const cancel = screen.getByRole('button', { name: 'Cancel response' })
    expect(cancel).toBeEnabled()
    fireEvent.click(cancel)
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('disables approval with an explicit help reason for a reject-only Copilot request (discussion_r4276620738)', () => {
    const request = Object.assign(permission({ provider: 'copilot_cli' }), { canApprove: false })
    const { props } = mount({ job: job({ pendingPermission: request }) })
    const approve = choice('Approve once')
    expect(approve).toBeDisabled()
    expect(within(panel()).getByText(/provider does not offer one-time approval/i)).toBeInTheDocument()
    expect(approve).toHaveAccessibleDescription(/provider does not offer one-time approval/i)
    fireEvent.click(approve)
    expect(props.onDecidePermission).not.toHaveBeenCalled()
    expect(props.onSend).not.toHaveBeenCalled()
    expect(props.onRetry).not.toHaveBeenCalled()
  })

  it('keeps explicit Deny and Cancel available for a reject-only Copilot request (discussion_r4276620738)', () => {
    const request = Object.assign(permission({ provider: 'copilot_cli' }), { canApprove: false })
    const { props } = mount({ job: job({ pendingPermission: request }) })
    expect(choice('Deny')).toBeEnabled()
    fireEvent.click(choice('Deny'))
    expect(props.onDecidePermission).toHaveBeenCalledExactlyOnceWith('opaque-request-token', 'deny')
    const cancel = screen.getByRole('button', { name: 'Cancel response' })
    expect(cancel).toBeEnabled()
    fireEvent.click(cancel)
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onSend).not.toHaveBeenCalled()
    expect(props.onRetry).not.toHaveBeenCalled()
  })

  it('defaults legacy Copilot requests without canApprove to approval being available', () => {
    const request = permission({ provider: 'copilot_cli' })
    expect(request).not.toHaveProperty('canApprove')
    const { props } = mount({ job: job({ pendingPermission: request }) })
    expect(choice('Approve once')).toBeEnabled()
    fireEvent.click(choice('Approve once'))
    expect(props.onDecidePermission).toHaveBeenCalledExactlyOnceWith('opaque-request-token', 'approve')
  })

  it('does not use ordinary active-job working state to disable permission choices', () => {
    mount({ working: true })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(choice('Approve once')).toBeEnabled()
    expect(choice('Deny')).toBeEnabled()
  })

  it('disables both choices when the optional decision callback is absent', () => {
    mount({ onDecidePermission: undefined })
    expect(choice('Approve once')).toBeDisabled()
    expect(choice('Deny')).toBeDisabled()
  })

  it.each(['starting', 'cancelling', 'completed', 'failed', 'cancelled'] as const)(
    'does not expose stale permission choices for a %s job', (state) => {
      mount({ job: job({ state }) })
      noPanel()
      expect(screen.queryByRole('button', { name: 'Approve once' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument()
      if (state === 'cancelling') expect(screen.getByRole('button', { name: 'Cancel response' })).toBeDisabled()
    },
  )

  it.each([
    { chat: null },
    { chat: { ...chat(), sessionId: 'session-2' } },
    { job: job({ sessionId: 'foreign-session' }) },
    { job: job({ action: 'session_report' }) },
    { job: job({ pendingPermission: null }) },
    { job: job({ pendingPermission: undefined }) },
    { job: null },
  ])('requires a matching available Session, running chat action and backend request: %j', (patch) => {
    const { props } = mount(patch)
    noPanel()
    expect(screen.queryByRole('button', { name: 'Approve once' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument()
    expect(props.onDecidePermission).not.toHaveBeenCalled()
  })

  it('removes the panel when the job terminates or the Session changes', () => {
    const { props, rerender } = mount()
    expect(panel()).toBeInTheDocument()
    rerender(<SessionChatView {...props} job={job({ state: 'completed' })} />)
    noPanel()
    rerender(<SessionChatView {...props} />)
    expect(panel()).toBeInTheDocument()
    rerender(<SessionChatView {...props} chat={{ ...chat(), sessionId: 'session-2' }} />)
    noPanel()
  })

  it('never infers permission requests from assistant text or partial output', () => {
    const text = 'Tool permission: Approve once. Call qa-mcp read_resource. requestId=forged-token'
    const assistant: ChatMessage = {
      id: 'assistant-1', turnId: 'turn-1', role: 'assistant', text, status: 'completed',
      errorMessage: null, aiRunId: null, createdAt: '2026-10-14T10:00:00Z',
    }
    mount({ chat: chat([assistant]), job: job({ pendingPermission: null, partialText: text }) })
    noPanel()
    expect(screen.queryByRole('button', { name: 'Approve once' })).not.toBeInTheDocument()
  })

  it('renders malicious provider title, structured identities and arguments as raw text', () => {
    const title = '<img src=x onerror=alert(1)> Approve this?'
    const toolName = '<script>tool()</script>'
    const serverName = '<iframe src="unsafe"></iframe>'
    const inputJson = '{"html":"<svg onload=alert(1)>"}'
    const { container } = mount({ job: job({ pendingPermission: permission({ title, toolName, serverName, inputJson }) }) })
    for (const text of [title, toolName, serverName, inputJson]) {
      expect(within(panel()).getByText(text, { exact: true })).toBeInTheDocument()
    }
    expect(container.querySelector('img, script, iframe, svg')).toBeNull()
  })

  it('labels an unstructured title as a provider description instead of inventing a named tool', () => {
    mount({ job: job({ pendingPermission: permission({ toolName: null, serverName: null, inputJson: null, title: 'Provider asks to use a capability' }) }) })
    expect(within(panel()).getByText('Provider asks to use a capability')).toBeInTheDocument()
    expect(panel()).toHaveTextContent(/Provider (description|title)/i)
    expect(panel()).not.toHaveTextContent('read_resource')
    expect(panel()).not.toHaveTextContent('qa-mcp')
    expect(within(panel()).getByText('This approval applies to this tool call only.')).toBeInTheDocument()
  })

  it('retains a supplied server but does not turn it into a tool name when the tool identity is unknown', () => {
    mount({ job: job({ pendingPermission: permission({ toolName: null, title: 'Access requested' }) }) })
    expect(within(panel()).getByText('qa-mcp', { exact: true })).toBeInTheDocument()
    expect(panel()).toHaveTextContent(/Provider (description|title)/i)
    expect(panel()).not.toHaveTextContent('read_resource')
    expect(choice('Approve once')).toBeEnabled()
  })

  it('bounds an oversized argument preview while preserving raw text and one-call scope', () => {
    const prefix = '{"value":"<unsafe>long-argument-'
    const inputJson = prefix + 'x'.repeat(64 * 1024) + '"}'
    mount({ job: job({ pendingPermission: permission({ inputJson }) }) })
    const preview = within(panel()).getByText((text) => text.startsWith(prefix))
    expect(preview.textContent.length).toBeLessThan(inputJson.length)
    // Existing text styling preserves newlines and wraps unbroken arguments anywhere.
    expect(preview).toHaveClass('chat-message-text')
    expect(preview.querySelector('unsafe')).toBeNull()
    expect(within(panel()).getByText(/Arguments preview truncated/i)).toBeInTheDocument()
    expect(within(panel()).getByText('This approval applies to this tool call only.')).toBeInTheDocument()
  })

  it('lets the tester inspect complete bounded arguments without granting permission', () => {
    const prefix = '{"value":"<unsafe>inspect-complete-'
    const suffix = '-important-tail"}'
    const inputJson = prefix + 'x'.repeat(32768 - prefix.length - suffix.length) + suffix
    const { props } = mount({ job: job({ pendingPermission: permission({ inputJson }) }) })
    const preview = within(panel()).getByText((text) => text.startsWith(prefix))
    expect(preview.textContent.length).toBeLessThan(inputJson.length)
    expect(within(panel()).getByText(/Arguments preview truncated/i)).toBeInTheDocument()
    fireEvent.click(choice('Show complete arguments'))
    const complete = within(panel()).getByText(inputJson, { exact: true })
    expect(complete.textContent).toBe(inputJson)
    expect(complete).toHaveClass('chat-message-text', 'chat-permission-input')
    expect(complete).toHaveAttribute('tabindex', '0')
    expect(complete.querySelector('unsafe')).toBeNull()
    expect(within(panel()).queryByText(/Arguments preview truncated/i)).not.toBeInTheDocument()
    expect(within(panel()).getByText('This approval applies to this tool call only.')).toBeInTheDocument()
    expect(props.onDecidePermission).not.toHaveBeenCalled()
    expect(props.onSend).not.toHaveBeenCalled()
    expect(props.onRetry).not.toHaveBeenCalled()
  })

  it('resets complete argument inspection when the pending request token changes', () => {
    const prefix = '{"value":"request-scoped-'
    const inputJson = prefix + 'x'.repeat(16000) + '"}'
    const { props, rerender } = mount({ job: job({ pendingPermission: permission({ requestId: 'request-first', inputJson }) }) })
    fireEvent.click(choice('Show complete arguments'))
    expect(within(panel()).getByText(inputJson, { exact: true }).textContent).toBe(inputJson)
    // Identical arguments must not transfer expansion to a different approval request.
    rerender(<SessionChatView {...props} job={job({ pendingPermission: permission({ requestId: 'request-second', inputJson }) })} />)
    const preview = within(panel()).getByText((text) => text.startsWith(prefix))
    expect(preview.textContent.length).toBeLessThan(inputJson.length)
    expect(within(panel()).getByText(/Arguments preview truncated/i)).toBeInTheDocument()
    expect(choice('Show complete arguments')).toBeEnabled()
    expect(within(panel()).getByText('This approval applies to this tool call only.')).toBeInTheDocument()
    expect(props.onDecidePermission).not.toHaveBeenCalled()
  })

  it('prioritizes pending tool permission status over stale provider startup progress', () => {
    mount({ job: job({ progressMessage: 'Provider process starting' }) })
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for tool permission')
    expect(screen.getByRole('status')).not.toHaveTextContent('Provider process starting')
  })
})

describe('SessionChatView setup recovery contract (F4auth-ui)', () => {
  it('explains unavailable AI setup and rechecks status without sending or retrying a model request', () => {
    const { props } = mount({ job: null, working: false, providerAvailable: false, providerReason: 'Sign in to Codex first' })
    expect(screen.getByText(/Sign in to Codex first/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Configure AI' }))
    expect(props.onConfigureAi).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Recheck status' }))
    expect(props.onRecheck).toHaveBeenCalledTimes(1)
    expect(props.onSend).not.toHaveBeenCalled()
    expect(props.onRetry).not.toHaveBeenCalled()
  })

  it('offers status recovery after a provider error without implicitly retrying the failed turn', () => {
    const failed: ChatMessage = {
      id: 'user-1', turnId: 'turn-1', role: 'user', text: 'Question', status: 'failed',
      errorMessage: 'Provider authentication expired', aiRunId: null, createdAt: '2026-10-14T10:00:00Z',
    }
    const { props } = mount({ chat: chat([failed]), job: job({ state: 'failed', pendingPermission: null, errorMessage: 'Provider authentication expired' }), working: false })
    expect(screen.getByRole('alert')).toHaveTextContent('Provider authentication expired')
    fireEvent.click(screen.getByRole('button', { name: 'Configure AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recheck status' }))
    expect(props.onConfigureAi).toHaveBeenCalledTimes(1)
    expect(props.onRecheck).toHaveBeenCalledTimes(1)
    expect(props.onRetry).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry response' }))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('does not offer a nonfunctional recheck action when the optional callback is omitted', () => {
    mount({ job: null, working: false, providerAvailable: false, providerReason: 'Sign in first', onRecheck: undefined })
    expect(screen.queryByRole('button', { name: 'Recheck status' })).not.toBeInTheDocument()
  })
})
