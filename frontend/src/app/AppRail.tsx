import type { KeyboardEvent } from 'react'
import { BrandMark } from '../components/BrandMark'
import { BookOpen, CircleHelp, FileText, Loader2, Plus, Search, Settings } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { RailItem } from '../components/Common'
import { formatSessionDate } from '../ui/format'
import type { AppController } from './useAppController'
import type { AppCommand, AppCommandId } from './commandRegistry'
import { primaryShortcutLabel } from './platformShortcuts'

export function AppRail({ c, commandById, onOpenCommands }: {
  c: AppController
  commandById: (id: AppCommandId) => AppCommand | undefined
  onOpenCommands: () => void
}) {
  const runCommand = (id: AppCommandId) => commandById(id)?.run()
  const newSession = commandById('session.new')
  const loadAll = commandById('sessions.load-all')
  const sessions = c.filteredSessions
  const sessionScopedView = c.activeView === 'sessions' || c.activeView === 'testware' || c.activeView === 'findings'
  // The open Session stays marked only while one of its tabs is showing.
  const currentSessionId = sessionScopedView ? c.activeSession?.id : undefined
  const tabbableSessionId = sessions.some((session) => session.id === currentSessionId) ? currentSessionId : sessions[0]?.id
  const libraryView = c.activeView === 'testware-library' || c.activeView === 'findings-library'

  return (
    <aside className="left-rail" aria-label="Workspace navigation">
      <div className="rail-head">
        <div className="brand-cluster">
          <span className="brand-mark"><BrandMark size={20} /></span>
          <strong>QA Scribe</strong>
        </div>
        <button className="command-palette-trigger" type="button" aria-label="Open command palette" title="Search and commands" onClick={onOpenCommands}>
          <kbd>{primaryShortcutLabel('k')}</kbd>
        </button>
      </div>

      {newSession ? (
        <ActionButton variant="secondary" className="top-new-button" type="button" disabled={!newSession.available} onClick={newSession.run}>
          {c.busyAction === 'new-session' ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
          {newSession.label}
        </ActionButton>
      ) : null}

      <label className="global-search">
        <Search size={16} />
        <span className="sr-only">Search Sessions</span>
        <input value={c.searchQuery} onChange={(event) => c.setSearchQuery(event.target.value)} placeholder="Search Sessions…" />
      </label>

      <section className="session-picker contextual-rail" aria-label="Sessions">
        <p className="rail-heading">Sessions</p>
        <div className="session-picker-list" role="listbox" aria-label="Sessions">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={currentSessionId === session.id ? 'session-picker-item active' : 'session-picker-item'}
              type="button"
              role="option"
              aria-selected={currentSessionId === session.id}
              tabIndex={tabbableSessionId === session.id ? 0 : -1}
              disabled={c.isBusy && c.activeSession?.id !== session.id}
              onClick={() => void c.openSessionInCurrentView(session)}
              onKeyDown={focusListboxOption}
            >
              <span className="session-picker-title" title={session.title}>{session.title}</span>
              <small className="session-picker-date">{formatSessionDate(session.updatedAt)}</small>
            </button>
          ))}
          {sessions.length === 0 ? <p className="session-picker-empty">No matching sessions</p> : null}
        </div>
        {!c.sessionLibraryComplete ? (
          <ActionButton variant="secondary" type="button" disabled={!loadAll?.available} onClick={() => runCommand('sessions.load-all')}>
            {c.busyAction === 'load-session-library' ? <Loader2 className="spin" size={16} /> : null}
            {loadAll?.label}
          </ActionButton>
        ) : null}
      </section>

      <label className="compact-session-select">
        <span>Session</span>
        <select
          value={c.activeSession?.id ?? ''}
          disabled={c.isBusy || c.sessions.length === 0}
          onChange={(event) => {
            const session = c.sessions.find((candidate) => candidate.id === event.target.value)
            if (session) void c.openSessionInCurrentView(session)
          }}
        >
          {c.sessions.length === 0 ? <option value="">No Sessions yet</option> : null}
          {c.sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
        </select>
      </label>

      <nav className="workspace-nav" aria-label="Workspace sections">
        <RailItem icon={FileText} label="Sessions" count={c.sessions.length} active={sessionScopedView} onClick={() => runCommand('view.note')} />
        <RailItem icon={BookOpen} label="Library" active={libraryView} onClick={() => runCommand(c.activeView === 'findings-library' ? 'library.findings' : 'library.testware')} />
      </nav>

      <div className="rail-utilities">
        <button className="help-link" type="button" aria-label="Help" title="Help" onClick={() => runCommand('help.open')}>
          <CircleHelp size={16} /> Help
        </button>
        <button className={c.activeView === 'settings' ? 'settings-link active' : 'settings-link'} type="button" aria-current={c.activeView === 'settings' ? 'page' : undefined} onClick={() => runCommand('settings.open')}>
          <Settings size={16} />
          Settings
        </button>
      </div>
    </aside>
  )
}

function focusListboxOption(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const listbox = event.currentTarget.closest('[role="listbox"]')
  const options = Array.from(listbox?.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)') ?? [])
  if (options.length === 0) return

  const currentIndex = Math.max(0, options.indexOf(event.currentTarget))
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? options.length - 1
      : event.key === 'ArrowUp' ? Math.max(0, currentIndex - 1)
        : Math.min(options.length - 1, currentIndex + 1)
  event.preventDefault()
  options[nextIndex]?.focus()
}
