import type { ChatLogCapture } from '../bindings'

export function ChatLogActivity({ captures }: { captures?: ChatLogCapture[] }) {
  if (!captures?.length) return null
  return <details className="chat-permission-details">
    <summary>Recent approved log queries</summary>
    <ul>
      {captures.map(capture => <li key={capture.id}>
        <details>
          <summary>{capture.targetLabel} · {capture.rowCount} {capture.rowCount === 1 ? 'row' : 'rows'}{capture.truncated ? ' (truncated)' : ''}</summary>
          <p className="chat-help"><time>{capture.start}</time> to <time>{capture.end}</time> UTC · {capture.provider === 'claude_code' ? 'Claude Code' : 'Codex'}</p>
          <pre className="chat-message-text chat-permission-input" dir="ltr">{capture.kql}</pre>
        </details>
      </li>)}
    </ul>
  </details>
}
