import { Archive, Loader2, Plus } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { Session } from '../../../shared/contracts'

export function SessionSidebar(props: {
  sessions: Session[]
  selectedSessionId: string | null
  onCreateSession: () => Promise<void>
  onOpenSession: (id: string) => Promise<void>
  busy?: boolean
  newSessionBusy?: boolean
  newSessionDisabled?: boolean
}): ReactElement {
  const [createPending, setCreatePending] = useState(false)
  const newSessionBusy = createPending || props.busy === true || props.newSessionBusy === true
  const newSessionDisabled = newSessionBusy || props.newSessionDisabled === true

  async function createSession(): Promise<void> {
    if (newSessionDisabled) return

    setCreatePending(true)
    try {
      await props.onCreateSession()
    } finally {
      setCreatePending(false)
    }
  }

  return (
    <aside className="session-sidebar" aria-label="Session Library">
      <div className="sidebar-title">
        <Archive size={18} />
        <span>qa-scribe</span>
      </div>

      <button
        aria-busy={newSessionBusy}
        className="primary-command"
        disabled={newSessionDisabled}
        onClick={() => void createSession()}
        type="button"
      >
        {newSessionBusy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
        {newSessionBusy ? 'Creating...' : 'New Session'}
      </button>

      <div className="session-list" aria-label="Saved sessions">
        {props.sessions.length === 0 ? (
          <div className="session-empty" role="status">
            <strong>No saved sessions</strong>
            <span>Create a session to start capturing notes and evidence.</span>
          </div>
        ) : (
          props.sessions.map((session) => {
            const selected = session.id === props.selectedSessionId
            const summary = sessionSummary(session)
            const metadata = sessionMetadata(session)
            const activity = sessionActivity(session)

            return (
              <button
                aria-current={selected ? 'page' : undefined}
                aria-label={[session.title, summary, ...metadata, activity.label].filter(Boolean).join('. ')}
                className={selected ? 'session-row selected' : 'session-row'}
                key={session.id}
                onClick={() => void props.onOpenSession(session.id)}
                type="button"
              >
                <span className="session-row-title">{session.title}</span>
                <small className="session-row-summary">{summary}</small>
                <small className="session-row-meta">
                  {metadata.length > 0 ? <span>{metadata.join(' · ')}</span> : null}
                  {metadata.length > 0 ? <span aria-hidden="true"> · </span> : null}
                  <time dateTime={activity.dateTime}>{activity.label}</time>
                </small>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}

function sessionSummary(session: Session): string {
  return compactValues([session.testTarget, session.charter]).join(' · ') || 'No context'
}

function sessionMetadata(session: Session): string[] {
  return compactValues([
    session.environment ? `Env: ${session.environment}` : null,
    session.buildVersion ? `Build: ${session.buildVersion}` : null,
    session.relatedReference ? `Ref: ${session.relatedReference}` : null
  ])
}

function sessionActivity(session: Session): { dateTime: string; label: string } {
  const updatedAt = validDateValue(session.updatedAt)
  const openedAt = validDateValue(session.lastOpenedAt)
  const createdAt = validDateValue(session.createdAt)
  const dateTime = openedAt ?? updatedAt ?? createdAt ?? session.lastOpenedAt
  const labelPrefix = openedAt ? 'Opened' : updatedAt ? 'Updated' : 'Created'
  return {
    dateTime,
    label: `${labelPrefix} ${formatSessionDate(dateTime)}`
  }
}

function compactValues(values: Array<string | null | undefined>): string[] {
  return values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))
}

function validDateValue(value: string): string | null {
  return Number.isNaN(new Date(value).getTime()) ? null : value
}

function formatSessionDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)
}
