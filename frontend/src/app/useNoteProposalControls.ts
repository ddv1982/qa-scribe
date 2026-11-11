import { useLayoutEffect, useRef, useState } from 'react'
import type { RichEditorDocument } from '../editor/editorDocument'
import { parseRichEditorDocument, preserveManagedImageNodes, serializeRichEditorDocument } from '../editor/editorDocument'
import { resolveRefinement } from '../tauri'
import type { ProposalControls } from './sessionChat.proposals'
import type { SessionChatViewState } from './sessionChat.types'

export const noteChangedReason = 'The note changed after the update. Use Ctrl+Z in the note to step back.'

type Applied = { before: RichEditorDocument; after: string }

/** Update note replaces the live Note editor content (one undoable editor change); autosave persists it. */
export function useNoteProposalControls({ chat, onRefresh, noteBody, setNoteBody, recordControls }: Pick<SessionChatViewState, 'chat' | 'onRefresh'> & {
  noteBody: RichEditorDocument; setNoteBody: (next: RichEditorDocument) => void
  /** Older Notes conversations can hold record proposals; those keep their record controls. */
  recordControls?: ProposalControls
}): ProposalControls {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [applied, setApplied] = useState<ReadonlyMap<string, Applied>>(new Map())
  const current = serializeRichEditorDocument(noteBody)
  const latest = useRef(current)
  useLayoutEffect(() => { latest.current = current })
  const fail = (id: string, message: string) => setErrors(previous => ({ ...previous, [id]: message }))
  const clear = (id: string) => setErrors(previous => { const { [id]: _removed, ...rest } = previous; return rest })

  async function onUpdate(id: string) {
    const proposal = chat?.proposals?.find(item => item.id === id)
    const after = proposal ? parseRichEditorDocument(proposal.after.documentJson) : null
    if (!chat || !proposal || proposal.state.kind !== 'offered' || !after) { fail(id, 'This suggestion can no longer be applied.'); return }
    // Apply to the live editor before any await, so a Session switch or a newer edit cannot be overwritten.
    const before = noteBody
    const next = preserveManagedImageNodes(before, after)
    const appliedText = serializeRichEditorDocument(next)
    setNoteBody(next)
    setApplied(previous => new Map(previous).set(id, { before, after: appliedText }))
    setPending(previous => new Set(previous).add(id))
    try {
      await resolveRefinement({ scope: { sessionId: chat.sessionId, draftId: chat.draftId, expectedRevision: chat.revision }, proposalId: id, action: 'stage' })
      clear(id)
      await onRefresh?.()
    } catch (cause) {
      if (latest.current === appliedText) setNoteBody(before)
      setApplied(previous => { const rest = new Map(previous); rest.delete(id); return rest })
      fail(id, cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(previous => { const rest = new Set(previous); rest.delete(id); return rest })
    }
  }

  function undo(id: string) {
    const entry = applied.get(id)
    if (!entry || entry.after !== current) { fail(id, noteChangedReason); return }
    setNoteBody(entry.before)
    setApplied(previous => { const rest = new Map(previous); rest.delete(id); return rest })
    clear(id)
  }

  const isNote = (id: string) => chat?.proposals?.find(item => item.id === id)?.patch.kind === 'note'
  return {
    ...recordControls,
    errors: { ...recordControls?.errors, ...errors },
    pending: new Set([...recordControls?.pending ?? [], ...pending]),
    undoable: new Set([...applied].filter(([, entry]) => entry.after === current).map(([id]) => id)),
    onUpdate: async (id, reference) => { if (isNote(id)) await onUpdate(id); else await recordControls?.onUpdate?.(id, reference) },
    onAction: async (id, action, reference) => {
      if (!isNote(id)) await recordControls?.onAction(id, action, reference)
      else if (action === 'undo') undo(id)
    },
  }
}
