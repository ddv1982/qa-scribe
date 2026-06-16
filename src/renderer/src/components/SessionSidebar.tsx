import { Archive, Plus } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Session } from '../../../shared/contracts'

export function SessionSidebar(props: {
  sessions: Session[]
  selectedSessionId: string | null
  onCreateSession: () => Promise<void>
  onOpenSession: (id: string) => Promise<void>
}): ReactElement {
  return (
    <aside className="session-sidebar" aria-label="Session Library">
      <div className="sidebar-title">
        <Archive size={18} />
        <span>qa-scribe</span>
      </div>

      <button className="primary-command" onClick={props.onCreateSession} type="button">
        <Plus size={17} />
        New Session
      </button>

      <div className="session-list">
        {props.sessions.map((session) => (
          <button
            className={session.id === props.selectedSessionId ? 'session-row selected' : 'session-row'}
            key={session.id}
            onClick={() => props.onOpenSession(session.id)}
            type="button"
          >
            <span>{session.title}</span>
            <small>{session.testTarget || 'No target'}</small>
          </button>
        ))}
      </div>
    </aside>
  )
}
