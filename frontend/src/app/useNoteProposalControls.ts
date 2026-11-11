import { useLayoutEffect, useRef, useState } from 'react'
import type { RichEditorDocument } from '../editor/editorDocument'
import { parseRichEditorDocument, preserveManagedImageNodes, serializeRichEditorDocument } from '../editor/editorDocument'
import { resolveRefinement } from '../tauri'
import type { ProposalControls } from './sessionChat.proposals'
import type { SessionChatViewState } from './sessionChat.types'

export const noteChangedReason = 'The note changed after the update. Use Ctrl+Z in the note to step back.'
/** The Note editor refuses edits while the Session Note is being recovered. */
export const noteReadOnlyReason = 'Recover the Session Note before updating it.'
export const noteChangedWhileUpdatingReason = 'The note changed while updating, so the suggestion was not applied. Ask AI again for a suggestion based on the current note.'

type Applied = { sessionId: string; before: RichEditorDocument; beforeText: string; after: string }

/**
 * Update note saves pending Note edits, lets the server confirm the suggestion was made from the
 * current stored Note, then replaces the live Note editor content (one undoable editor change).
 */
export function useNoteProposalControls({ chat, onRefresh, noteBody, setNoteBody, saveNote, blockedReason, recordControls }: Pick<SessionChatViewState, 'chat' | 'onRefresh'> & {
  noteBody: RichEditorDocument; setNoteBody: (next: RichEditorDocument) => void
  /** Saves on-screen Note edits so the server compares the suggestion with what is on screen. */
  saveNote: () => Promise<boolean>
  /** Why Update note must wait, such as an unresolved recovered Summary choice. */
  blockedReason?: string
  /** Older Notes conversations can hold record proposals; those keep their record controls. */
  recordControls?: ProposalControls
}): ProposalControls {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [applied, setApplied] = useState<ReadonlyMap<string, Applied>>(new Map())
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(new Set())
  /** Undone suggestions with the Session and Note text they may be applied to again. */
  const [undone, setUndone] = useState<ReadonlyMap<string, Pick<Applied, 'sessionId' | 'beforeText'>>>(new Map())
  const current = serializeRichEditorDocument(noteBody)
  const sessionId = chat?.sessionId ?? null
  const latest = useRef({ sessionId, note: current, body: noteBody })
  useLayoutEffect(() => { latest.current = { sessionId, note: current, body: noteBody } })
  /** The editor still shows this Session's applied Note, so restoring cannot touch newer or other-Session content. */
  const stillApplied = (entry: Applied) => latest.current.sessionId === entry.sessionId && latest.current.note === entry.after
  const offeredAgain = (id: string) => { const entry = undone.get(id); return Boolean(entry && entry.sessionId === sessionId && entry.beforeText === current) }
  const fail = (id: string, message: string) => setErrors(previous => ({ ...previous, [id]: message }))
  const clear = (id: string) => setErrors(previous => { const { [id]: _removed, ...rest } = previous; return rest })
  const drop = <T,>(map: ReadonlyMap<string, T>, id: string) => { const rest = new Map(map); rest.delete(id); return rest }

  async function onUpdate(id: string) {
    const proposal = chat?.proposals?.find(item => item.id === id)
    const after = proposal ? parseRichEditorDocument(proposal.after.documentJson) : null
    // An undone suggestion is offered again while the Note is back to its pre-update text.
    if (!chat || !proposal || (proposal.state.kind !== 'offered' && !offeredAgain(id)) || !after) { fail(id, 'This suggestion can no longer be applied.'); return }
    if (blockedReason) { fail(id, blockedReason); return }
    setPending(previous => new Set(previous).add(id))
    try {
      if (!await saveNote()) { fail(id, 'Save the note before updating it. Your edits are kept.'); return }
      const saved = latest.current
      try {
        await resolveRefinement({ scope: { sessionId: chat.sessionId, draftId: chat.draftId, expectedRevision: chat.revision }, proposalId: id, action: 'stage' })
      } catch (cause) {
        fail(id, cause instanceof Error ? cause.message : String(cause))
        return
      }
      if (latest.current.sessionId !== chat.sessionId || latest.current.note !== saved.note) { fail(id, noteChangedWhileUpdatingReason); return }
      const next = preserveManagedImageNodes(saved.body, after)
      setNoteBody(next)
      setApplied(previous => new Map(previous).set(id, { sessionId: chat.sessionId, before: saved.body, beforeText: saved.note, after: serializeRichEditorDocument(next) }))
      setRecorded(previous => new Set(previous).add(id))
      setUndone(previous => drop(previous, id))
      clear(id)
      // The update is recorded; a failed refresh keeps the applied Note and its Undo.
      await onRefresh?.().catch(() => undefined)
    } finally {
      setPending(previous => { const rest = new Set(previous); rest.delete(id); return rest })
    }
  }

  function undo(id: string) {
    const entry = applied.get(id)
    if (!entry || !stillApplied(entry)) { fail(id, noteChangedReason); return }
    setNoteBody(entry.before)
    setApplied(previous => drop(previous, id))
    setRecorded(previous => { const rest = new Set(previous); rest.delete(id); return rest })
    setUndone(previous => new Map(previous).set(id, { sessionId: entry.sessionId, beforeText: entry.beforeText }))
    clear(id)
  }

  const isNote = (id: string) => chat?.proposals?.find(item => item.id === id)?.patch.kind === 'note'
  return {
    ...recordControls,
    errors: { ...recordControls?.errors, ...errors },
    pending: new Set([...recordControls?.pending ?? [], ...pending]),
    applied: recorded,
    undone: new Set([...undone.keys()].filter(offeredAgain)),
    undoable: new Set([...applied].filter(([, entry]) => entry.sessionId === sessionId && entry.after === current).map(([id]) => id)),
    onUpdate: async (id, reference) => { if (isNote(id)) await onUpdate(id); else await recordControls?.onUpdate?.(id, reference) },
    onAction: async (id, action, reference) => {
      if (!isNote(id)) await recordControls?.onAction(id, action, reference)
      else if (action === 'undo') undo(id)
    },
  }
}
