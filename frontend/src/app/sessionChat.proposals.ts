import { useEffect, useRef, useState } from 'react'
import { getChat, resolveRefinement, type RefinementAction, type RefinementProposal } from '../tauri'
import { parseRichEditorDocument, preserveManagedImageNodes, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { editorKey, editorValue } from './recordWriteGuards'
import { formatError } from '../ui/format'
import type { SessionChatViewState } from './sessionChat.types'
import type { RecordActionsContext } from './recordActions'
import type { useRecordActions } from './recordActions'
import type { RecordPersistence } from './recordPersistence'
import type { useAskAiContext } from './useAskAiContext'
import type { CreatedRecordEditTarget, RecordWorkspace } from './types'

export type ProposalControls = {
  errors: Readonly<Record<string, string>>
  pending: ReadonlySet<string>
  preparedOnly?: ReadonlySet<string>
  onAction: (proposalId: string, action: RefinementAction) => Promise<void>
}

type Context = {
  chat: SessionChatViewState
  askAi: ReturnType<typeof useAskAiContext>
  records: RecordWorkspace
  actions: ReturnType<typeof useRecordActions>
  persistence: RecordPersistence
  session: RecordActionsContext['session']
  openEditor: (target: CreatedRecordEditTarget) => void
  feedback: RecordActionsContext['feedback']
}

export function useRefinementController(context: Context): SessionChatViewState {
  const live = useRef(context)
  useEffect(() => { live.current = context }, [context])
  const running = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [, refreshActivity] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})

  function local(proposal: RefinementProposal) {
    const ctx = live.current
    const target = proposal.target
    if (target.kind === 'session') throw new Error('This proposal has no record context.')
    const snapshot = target.snapshot
    if (ctx.session.activeSessionIdRef.current !== snapshot.sessionId) throw new Error('Open the original Session to review this proposal.')
    const selected = ctx.askAi.capture(snapshot.sessionId)
    if (selected.kind !== target.kind || selected.snapshot.recordId !== snapshot.recordId) throw new Error('Select the original record before applying or undoing this proposal.')
    const kind: 'finding' | 'draft' = target.kind === 'finding' ? 'finding' : 'draft'
    const record = kind === 'finding' ? ctx.records.findingsRef.current.find(item => item.id === snapshot.recordId) : ctx.records.draftsRef.current.find(item => item.id === snapshot.recordId)
    if (!record || record.sessionId !== snapshot.sessionId) throw new Error('This record was deleted or is no longer available.')
    const intent = kind === 'finding' ? ctx.persistence.coordination.findingIntents.get(record.id) : ctx.persistence.coordination.draftIntents.get(record.id)
    if (intent?.kind === 'delete' || ctx.persistence.coordination.hasPendingRecordCompensations()) throw new Error('Wait for pending record writes before applying this proposal.')
    return { ctx, record, kind, generation: intent?.generation ?? 0, key: editorKey(editorValue(record)) }
  }

  async function onAction(id: string, action: RefinementAction) {
    if (running.current.has(id)) return
    running.current.add(id); setPending(new Set(running.current))
    setErrors(previous => { const next = { ...previous }; delete next[id]; return next })
    let prepared: RefinementProposal | undefined
    try {
      const current = live.current.chat.chat
      const proposal = current?.proposals?.find(item => item.id === id)
      if (!current || !proposal || current.submission) throw new Error('This conversation is read-only or the proposal is unavailable.')
      let duplicate = false
      let checked: ReturnType<typeof local> | undefined
      if (action === 'stage' || action === 'undo') {
        checked = local(proposal)
        const required = action === 'stage' ? proposal.before : proposal.after
        if (checked.key !== editorKey(required)) {
          if ((action === 'stage' && proposal.state.kind === 'staged' && checked.key === editorKey(proposal.after)) || (action === 'undo' && checked.key === editorKey(proposal.before))) duplicate = true
          else
          throw new Error('The local editor changed. Your newer edits are retained. Review the current record and request a fresh refinement.')
        }
      }
      const fresh = await getChat(current.sessionId)
      if (fresh.draftId !== current.draftId) throw new Error('The conversation changed. Review the current conversation.')
      if (action === 'undo' && checked) {
        const latest = local(proposal)
        if (latest.key !== checked.key || latest.generation !== checked.generation) throw new Error('The editor changed while preparing Undo. Your newer edits are retained.')
        const currentProposal = fresh.proposals?.find(item => item.id === id)
        if (fresh.submission || !currentProposal || (currentProposal.state.kind !== 'staged' && currentProposal.state.kind !== 'undone')) throw new Error('This proposal no longer has an unsaved edit to undo.')
        if (!duplicate) {
          const document = parseRichEditorDocument(proposal.before.documentJson)
          if (!document) throw new Error('The original document is unavailable.')
          const patch = { title: proposal.before.title, ...richEditorDocumentToStoredBody(document) }
          if (latest.kind === 'finding') latest.ctx.actions.updateLocalFinding(latest.record.id, { ...patch, metadataJson: proposal.before.metadataJson })
          else latest.ctx.actions.updateLocalDraft(latest.record.id, patch)
        }
        latest.ctx.persistence.coordination.clearStage(latest.kind, latest.record.id)
      }
      const result = await resolveRefinement({ scope: { sessionId: fresh.sessionId, draftId: fresh.draftId, expectedRevision: fresh.revision }, proposalId: id, action })
      const resolved = result.proposals?.find(item => item.id === id)
      if (action === 'stage' && resolved?.state.kind === 'staged' && !duplicate) prepared = resolved
      if (action === 'stage' && checked && resolved && !duplicate) {
        const latest = local(proposal)
        if (latest.key !== checked.key || latest.generation !== checked.generation) throw new Error('The editor changed while preparing this proposal. Your newer edits are retained. Review again before applying.')
        const value = resolved.after
        const document = parseRichEditorDocument(value.documentJson)
        const beforeDocument = parseRichEditorDocument(resolved.before.documentJson)
        if (!document || !beforeDocument) throw new Error('The reviewed document is unavailable. Request another refinement.')
        const body = richEditorDocumentToStoredBody(preserveManagedImageNodes(beforeDocument, document))
        if (resolved.state.kind === 'staged') {
          latest.ctx.persistence.coordination.proposalStages.set(`${latest.kind}:${latest.record.id}`, resolved.state.stage)
          latest.ctx.persistence.coordination.latestWriteGuards.delete(`${latest.kind}:${latest.record.id}`)
        } else latest.ctx.persistence.coordination.clearStage(latest.kind, latest.record.id)
        const patch = { title: value.title, ...body }
        if (latest.kind === 'finding') latest.ctx.actions.updateLocalFinding(latest.record.id, { ...patch, metadataJson: value.metadataJson })
        else latest.ctx.actions.updateLocalDraft(latest.record.id, patch)
        latest.ctx.askAi.onSelectRecord({ kind: proposal.target.kind === 'finding' ? 'finding' : 'test_cases_draft', recordId: latest.record.id, title: value.title, unsaved: true })
        latest.ctx.feedback.setNotice('Suggested changes applied locally. Save the record to persist them.')
        latest.ctx.openEditor({ sessionId: latest.record.sessionId, kind: latest.kind === 'finding' ? 'finding' : 'testware', recordId: latest.record.id, editing: true })
      }
      await live.current.chat.onRefresh?.()
    } catch (cause) {
      if (prepared && prepared.target.kind !== 'session' && !live.current.persistence.coordination.proposalStages.has(`${prepared.target.kind === 'finding' ? 'finding' : 'draft'}:${prepared.target.snapshot.recordId}`)) {
        try {
          const fresh = await getChat(prepared.target.snapshot.sessionId)
          await resolveRefinement({ scope: { sessionId: fresh.sessionId, draftId: fresh.draftId, expectedRevision: fresh.revision }, proposalId: prepared.id, action: 'abandon' })
        } catch { setErrors(previous => ({ ...previous, [id]: 'The prepared change remains unresolved. Keep current edits to resolve it without replacing them.' })) }
      }
      setErrors(previous => ({ ...previous, [id]: formatError(cause) }))
      await live.current.chat.onRefresh?.()
    } finally { running.current.delete(id); setPending(new Set(running.current)) }
  }

  useEffect(() => context.persistence.coordination.subscribeChanges((kind, recordId, reason) => {
    refreshActivity(value => value + 1)
    if (!reason) return
    const current = live.current.chat.chat
    const proposal = current?.proposals?.find(item => item.target.kind !== 'session' && item.target.snapshot.recordId === recordId && (item.target.kind === 'finding' ? 'finding' : 'draft') === kind && item.state.kind === 'staged')
    if (proposal && reason === 'conflict') setErrors(previous => ({ ...previous, [proposal.id]: 'Stored record changed. Your local changes are retained. Use the record editor Discard control to review the newer saved record.' }))
    if (proposal && reason === 'discard') void onAction(proposal.id, 'discard')
    else void live.current.chat.onRefresh?.()
  }), [context.persistence, context.chat])
  const preparedOnly = new Set((context.chat.chat?.proposals ?? []).filter(item => item.state.kind === 'staged' && item.target.kind !== 'session' && !context.persistence.coordination.proposalStages.has(`${item.target.kind === 'finding' ? 'finding' : 'draft'}:${item.target.snapshot.recordId}`)).map(item => item.id))
  const controls: ProposalControls = { errors, pending, onAction, preparedOnly }
  const recordWritesPending = context.persistence.coordination.hasPendingRecordCompensations()
  const handoff = recordWritesPending && context.chat.handoff.kind !== 'recover' ? { ...context.chat.handoff, kind: 'settling' as const, reason: 'Wait for pending record writes before adding the conversation.' } : context.chat.handoff
  return { ...context.chat, handoff, recordWritesPending, proposalControls: controls }
}
