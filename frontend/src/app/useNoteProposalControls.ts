import { useLayoutEffect, useRef, useState } from 'react'
import type { Entry } from '../bindings'
import { applyNoteRefinement } from '../tauri'
import { serializeRichEditorDocument, type RichEditorDocument } from '../editor/editorDocument'
import { formatError } from '../ui/format'
import type { ProposalControls } from './sessionChat.proposals'
import type { SessionChatViewState } from './sessionChat.types'

export const noteReadOnlyReason = 'Recover the Session Note before updating it.'

export function useNoteProposalControls({ chat, onRefresh, noteBody, adoptNote, saveNote, blockedReason, recordControls }: Pick<SessionChatViewState, 'chat' | 'onRefresh'> & {
  noteBody: RichEditorDocument
  adoptNote: (note: Entry, expected: string) => void
  saveNote: () => Promise<boolean>
  blockedReason?: string
  recordControls?: ProposalControls
}): ProposalControls {
  const operation = useRef<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [returned, setReturned] = useState<typeof chat>(null)
  const latest = useRef({ chat, noteBody })
  useLayoutEffect(() => { latest.current = { chat, noteBody } })
  const selected = chat && returned?.draftId === chat.draftId && returned.revision > chat.revision ? returned : chat
  const noteProposals = selected?.proposals?.filter(proposal => proposal.patch.kind === 'note') ?? []
  const isNote = (id: string) => noteProposals.some(proposal => proposal.id === id)

  async function change(id: string, undo: boolean) {
    if (!selected || operation.current) return
    operation.current = id
    setPending(id)
    try {
      if (blockedReason) throw new Error(blockedReason)
      if (!await saveNote()) throw new Error('Save the Note before updating it. Your edits are kept.')
      if (latest.current.chat?.draftId !== selected.draftId) return
      const expected = serializeRichEditorDocument(latest.current.noteBody)
      const result = await applyNoteRefinement({
        reference: { sessionId: selected.sessionId, draftId: selected.draftId },
        proposalId: id, undo,
      })
      adoptNote(result.note, expected)
      setReturned(result.chat)
      setErrors(previous => { const next = { ...previous }; delete next[id]; return next })
      await onRefresh?.().catch(() => undefined)
    } catch (cause) {
      setErrors(previous => ({ ...previous, [id]: formatError(cause) }))
      await onRefresh?.().catch(() => undefined)
    } finally {
      operation.current = null
      setPending(null)
    }
  }

  return {
    ...recordControls,
    errors: { ...recordControls?.errors, ...errors },
    pending: new Set([...recordControls?.pending ?? [], ...(pending ? [pending] : [])]),
    applied: new Set(noteProposals.filter(proposal => proposal.state.kind === 'note_applied').map(proposal => proposal.id)),
    undone: new Set(noteProposals.filter(proposal => proposal.state.kind === 'offered').map(proposal => proposal.id)),
    undoable: new Set(noteProposals.filter(proposal => proposal.state.kind === 'note_applied').map(proposal => proposal.id)),
    applyUnavailable: blockedReason ?? recordControls?.applyUnavailable,
    noteBefore: noteBody,
    onUpdate: async (id, reference) => { if (isNote(id)) await change(id, false); else await recordControls?.onUpdate?.(id, reference) },
    onAction: async (id, action, reference) => {
      if (!isNote(id)) await recordControls?.onAction(id, action, reference)
      else if (action === 'undo') await change(id, true)
    },
  }
}
