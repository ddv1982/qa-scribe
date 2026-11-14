import { useLayoutEffect, useState, type RefObject } from 'react'
import { creationNoteStorageKey, useRememberedVisible } from './useRememberedVisible'

export const creationNotePanelId = 'creation-note'

/** The workspace width at or below which a side panel covers the document area: the container query in ask-ai.css. */
const narrowWorkspace = 850

/** Whether the workspace is too narrow to show a side panel beside the document area. */
function useNarrowWorkspace(workspace: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const element = workspace.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setNarrow(element.clientWidth > 0 && element.clientWidth <= narrowWorkspace))
    observer.observe(element)
    return () => observer.disconnect()
  }, [workspace])
  return narrow
}

/**
 * Whether the panel beside the open draft (the Note, or a saved record) shows. In a wide workspace the choice is remembered. In a narrow one
 * the Note would cover the draft, so it is closed until opened for this draft, and that choice is not kept.
 */
export function useCreationNoteVisible(draftId: string | null, workspace: RefObject<HTMLElement | null>): [boolean, () => void] {
  const [remembered, remember] = useRememberedVisible(creationNoteStorageKey)
  const [chosen, setChosen] = useState<{ draftId: string; visible: boolean } | null>(null)
  const narrow = useNarrowWorkspace(workspace)
  const visible = chosen && chosen.draftId === draftId ? chosen.visible : remembered && !narrow
  const toggle = () => {
    if (!draftId) return
    if (narrow) setChosen({ draftId, visible: !visible })
    else { setChosen(null); remember(!visible) }
    // Focus follows the Note: into the panel when it opens, back to the button that brings it back when it closes.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(visible ? '.creation-note-toggle' : `#${creationNotePanelId} :is(select, button)`)?.focus())
  }
  return [visible, toggle]
}
