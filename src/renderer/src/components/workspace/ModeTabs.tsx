import type { ReactElement } from 'react'
import type { WorkspaceMode } from '../../domain/types'

export function ModeTabs(props: {
  mode: WorkspaceMode
  setMode: (mode: WorkspaceMode) => void
  onOpenGeneration: () => Promise<void>
}): ReactElement {
  return (
    <nav className="mode-tabs" aria-label="Workspace mode">
      <button className={props.mode === 'capture' ? 'selected' : ''} type="button" onClick={() => props.setMode('capture')}>
        Capture
      </button>
      <button
        className={props.mode === 'generation' ? 'selected' : ''}
        type="button"
        onClick={() => void props.onOpenGeneration()}
      >
        Generation Context
      </button>
      <button className={props.mode === 'drafts' ? 'selected' : ''} type="button" onClick={() => props.setMode('drafts')}>
        Drafts
      </button>
    </nav>
  )
}
