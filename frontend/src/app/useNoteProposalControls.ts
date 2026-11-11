import { useLayoutEffect, useRef, useState } from 'react'
import type { RichEditorDocument } from '../editor/editorDocument'
import { parseRichEditorDocument, preserveManagedImageNodes, serializeRichEditorDocument } from '../editor/editorDocument'
import { resolveRefinement } from '../tauri'
import type { ProposalControls } from './sessionChat.proposals'
import type { SessionChatViewState } from './sessionChat.types'

export const noteChangedReason = 'The note changed after the update. Use Ctrl+Z in the note to step back.'

type Applied = { sessionId: string; before: RichEditorDocument; after: string }

/** Update note replaces the live Note editor content (one undoable editor change); autosave persists it. */
export function useNoteProposalControls({ chat, onRefresh, noteBody, setNoteBody, recordControls }: Pick<SessionChatViewState, 'chat' | 'onRefresh'> & {
  noteBody: RichEditorDocument; setNoteBody: (next: RichEditorDocument) => void
  /** Older Notes conversations can hold record proposals; those keep their record controls. */
  recordControls?: ProposalControls
}): ProposalControls {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [applied, setApplied] = useState<ReadonlyMap<string, Applied>>(new Map())
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(new Set())
  const [undone, setUndone] = useState<ReadonlySet<string>>(new Set())
  const without = (set: ReadonlySet<string>, id: string) => { const rest = new Set(set); rest.delete(id); return rest }
  const current = serializeRichEditorDocument(noteBody)
  const sessionId = chat?.sessionId ?? null
  const latest = useRef({ sessionId, note: current })
  useLayoutEffect(() => { latest.current = { sessionId, note: current } })
  /** The editor still shows this Session's applied Note, so restoring cannot touch newer or other-Session content. */
  const stillApplied = (entry: Applied) => latest.current.sessionId === entry.sessionId && latest.current.note === entry.after
  const fail = (id: string, message: string) => setErrors(previous => ({ ...previous, [id]: message }))
  const clear = (id: string) => setErrors(previous => { const { [id]: _removed, ...rest } = previous; return rest })

  async function onUpdate(id: string) {
    const proposal = chat?.proposals?.find(item => item.id === id)
    const after = proposal ? parseRichEditorDocument(proposal.after.documentJson) : null
    // An undone suggestion is offered again; recording it a second time is idempotent on the server.
    if (!chat || !proposal || (proposal.state.kind !== 'offered' && !undone.has(id)) || !after) { fail(id, 'This suggestion can no longer be applied.'); return }
    // Apply to the live editor before any await, so a Session switch or a newer edit cannot be overwritten.
    const before = noteBody
    const next = preserveManagedImageNodes(before, after)
    const entry: Applied = { sessionId: chat.sessionId, before, after: serializeRichEditorDocument(next) }
    setNoteBody(next)
    setApplied(previous => new Map(previous).set(id, entry))
    setPending(previous => new Set(previous).add(id))
    try {
      try {
        await resolveRefinement({ scope: { sessionId: chat.sessionId, draftId: chat.draftId, expectedRevision: chat.revision }, proposalId: id, action: 'stage' })
      } catch (cause) {
        if (stillApplied(entry)) setNoteBody(before)
        setApplied(previous => { const rest = new Map(previous); rest.delete(id); return rest })
        fail(id, cause instanceof Error ? cause.message : String(cause))
        return
      }
      clear(id)
      setRecorded(previous => new Set(previous).add(id))
      setUndone(previous => without(previous, id))
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
    setApplied(previous => { const rest = new Map(previous); rest.delete(id); return rest })
    setRecorded(previous => without(previous, id))
    setUndone(previous => new Set(previous).add(id))
    clear(id)
  }

  const isNote = (id: string) => chat?.proposals?.find(item => item.id === id)?.patch.kind === 'note'
  return {
    ...recordControls,
    errors: { ...recordControls?.errors, ...errors },
    pending: new Set([...recordControls?.pending ?? [], ...pending]),
    applied: recorded, undone,
    undoable: new Set([...applied].filter(([, entry]) => entry.sessionId === sessionId && entry.after === current).map(([id]) => id)),
    onUpdate: async (id, reference) => { if (isNote(id)) await onUpdate(id); else await recordControls?.onUpdate?.(id, reference) },
    onAction: async (id, action, reference) => {
      if (!isNote(id)) await recordControls?.onAction(id, action, reference)
      else if (action === 'undo') undo(id)
    },
  }
}
