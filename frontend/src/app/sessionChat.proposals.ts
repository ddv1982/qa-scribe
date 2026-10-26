import { useEffect, useRef, useState } from 'react'
import { applyRefinement, getConversation, resolveRefinement, type ChatRef, type StageOrigin, type RefinementAction, type RefinementProposal, type RecordWriteGuard } from '../tauri'
import { parseRichEditorDocument, preserveManagedImageNodes, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { sameReference } from './sessionChat.workspaces'
import { editorKey, editorValue } from './recordWriteGuards'
import { formatError } from '../ui/format'
import type { SessionChatViewState } from './sessionChat.types'
import type { RecordActionsContext } from './recordActions'
import type { useRecordActions } from './recordActions'
import type { RecordPersistence } from './recordPersistence'
import type { useAskAiContext } from './useAskAiContext'
import type { CreatedRecordEditTarget, RecordWorkspace } from './types'

export type ProposalControls = {
  applyUnavailable?: string
  errors: Readonly<Record<string, string>>
  pending: ReadonlySet<string>
  onUpdate?: (proposalId: string, reference?: ChatRef) => Promise<void>
  preparedOnly?: ReadonlySet<string>
  onAction: (proposalId: string, action: RefinementAction, reference?: ChatRef) => Promise<void>
}

type Context = {
  conversations: import('./sessionChat.actions').ConversationEngine
  chat: Pick<SessionChatViewState, 'chat' | 'onRefresh'>
  askAi: ReturnType<typeof useAskAiContext>
  records: RecordWorkspace
  actions: ReturnType<typeof useRecordActions>
  persistence: RecordPersistence
  session: RecordActionsContext['session']
  openEditor: (target: CreatedRecordEditTarget) => void
  feedback: RecordActionsContext['feedback']
}

function editorBase(proposal: RefinementProposal): Pick<RecordWriteGuard, 'sessionId' | 'expectedStoredBase'> {
  if (proposal.target.kind === 'session') throw new Error('This proposal has no record context.')
  const snapshot = proposal.target.snapshot
  const expectedStoredBase = snapshot.storedBaseToken ?? ('stage' in proposal.state ? proposal.state.stage.storedBaseToken : undefined)
  if (!expectedStoredBase) throw new Error('This proposal has no stored record base. Request a new refinement.')
  return { sessionId: snapshot.sessionId, expectedStoredBase }
}

export function useRefinementController(context: Context) {
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
    return { ctx, record, kind, association: ctx.persistence.coordination.proposalStages.get(`${kind}:${record.id}`), base: editorBase(proposal), generation: intent?.generation ?? 0, key: editorKey(editorValue(record)) }
  }

  async function onAction(id: string, action: RefinementAction, capturedReference?: ChatRef) {
    if (running.current.has(id)) return
    running.current.add(id); setPending(new Set(running.current))
    setErrors(previous => { const next = { ...previous }; delete next[id]; return next })
    const invocation = live.current
    const current = capturedReference ? invocation.conversations.bind(capturedReference).snapshot().chat : invocation.chat.chat
    const reference: ChatRef | null = current ? { sessionId: current.sessionId, draftId: current.draftId } : null
    const epoch = invocation.askAi.selectionEpoch.current
    const conversationEpoch = invocation.conversations.selectionEpoch()
    const refresh = reference ? invocation.conversations.bind(reference).refresh : invocation.chat.onRefresh
    const stillSelected = () => sameReference(live.current.chat.chat, reference) && live.current.askAi.selectionEpoch.current === epoch && invocation.conversations.selectionEpoch() === conversationEpoch
    let prepared: RefinementProposal | undefined
    try {
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
      const fresh = await getConversation({ sessionId: current.sessionId, draftId: current.draftId })
      if (!sameReference(fresh, current)) throw new Error('The conversation changed. Review the current conversation.')
      if (action === 'undo' && checked) {
        if (!stillSelected()) throw new Error('The selection changed while preparing Undo. Your newer edits are retained.')
        const latest = local(proposal)
        if (latest.key !== checked.key || latest.generation !== checked.generation || latest.ctx.persistence.coordination.proposalStages.get(`${latest.kind}:${latest.record.id}`) !== checked.association) throw new Error('The editor changed while preparing Undo. Your newer edits are retained.')
        const currentProposal = fresh.proposals?.find(item => item.id === id)
        if (fresh.submission || !currentProposal || (currentProposal.state.kind !== 'staged' && currentProposal.state.kind !== 'undone')) throw new Error('This proposal no longer has an unsaved edit to undo.')
        if (!duplicate) {
          const document = parseRichEditorDocument(proposal.before.documentJson)
          if (!document) throw new Error('The original document is unavailable.')
          const patch = { title: proposal.before.title, ...richEditorDocumentToStoredBody(document) }
          if (latest.kind === 'finding') latest.ctx.actions.updateLocalFinding(latest.record.id, { ...patch, metadataJson: proposal.before.metadataJson })
          else latest.ctx.actions.updateLocalDraft(latest.record.id, patch)
        }
        latest.ctx.persistence.coordination.releaseStage(latest.kind, latest.record.id, latest.base, 'stage' in proposal.state ? proposal.state.stage.id : null)
      }
      if (action === 'abandon' && proposal.target.kind !== 'session') {
        const snapshot = proposal.target.snapshot
        invocation.persistence.coordination.releaseStage(proposal.target.kind === 'finding' ? 'finding' : 'draft', snapshot.recordId, editorBase(proposal), 'stage' in proposal.state ? proposal.state.stage.id : null)
      }
      const result = await resolveRefinement({ scope: { sessionId: fresh.sessionId, draftId: fresh.draftId, expectedRevision: fresh.revision }, proposalId: id, action })
      const resolved = result.proposals?.find(item => item.id === id)
      if (action === 'stage' && resolved?.state.kind === 'staged' && !duplicate) prepared = resolved
      if (action === 'stage' && checked && resolved && !duplicate) {
        if (!stillSelected()) throw new Error('The selection changed while preparing this proposal. Your newer edits are retained.')
        const latest = local(proposal)
        if (latest.key !== checked.key || latest.generation !== checked.generation || latest.ctx.persistence.coordination.proposalStages.get(`${latest.kind}:${latest.record.id}`) !== checked.association) throw new Error('The editor changed while preparing this proposal. Your newer edits are retained. Review again before applying.')
        const value = resolved.after
        const document = parseRichEditorDocument(value.documentJson)
        const beforeDocument = parseRichEditorDocument(resolved.before.documentJson)
        if (!document || !beforeDocument) throw new Error('The reviewed document is unavailable. Request another refinement.')
        const body = richEditorDocumentToStoredBody(preserveManagedImageNodes(beforeDocument, document))
        if (resolved.state.kind === 'staged') {
          latest.ctx.persistence.coordination.bindStage(latest.kind, latest.record.id, latest.record.sessionId, { ...resolved.state.stage, origin: {
            reference: { sessionId: current.sessionId, draftId: current.draftId }, proposalId: resolved.id, stageId: resolved.state.stage.id,
            record: { kind: proposal.target.kind === 'finding' ? 'finding' : 'test_cases_draft', recordId: latest.record.id },
          } })
        } else latest.ctx.persistence.coordination.releaseStage(latest.kind, latest.record.id, latest.base, 'stage' in proposal.state ? proposal.state.stage.id : null)
        const patch = { title: value.title, ...body }
        if (latest.kind === 'finding') latest.ctx.actions.updateLocalFinding(latest.record.id, { ...patch, metadataJson: value.metadataJson })
        else latest.ctx.actions.updateLocalDraft(latest.record.id, patch)
        latest.ctx.askAi.onSelectRecord({ kind: proposal.target.kind === 'finding' ? 'finding' : 'test_cases_draft', recordId: latest.record.id, title: value.title, unsaved: true })
        latest.ctx.feedback.setNotice('Suggested changes applied locally. Save the record to persist them.')
        latest.ctx.openEditor({ sessionId: latest.record.sessionId, kind: latest.kind === 'finding' ? 'finding' : 'testware', recordId: latest.record.id, editing: true })
      }
    } catch (cause) {
      if (prepared && prepared.target.kind !== 'session' && invocation.persistence.coordination.proposalStages.get(`${prepared.target.kind === 'finding' ? 'finding' : 'draft'}:${prepared.target.snapshot.recordId}`)?.id !== ('stage' in prepared.state ? prepared.state.stage.id : undefined)) {
        try {
          const fresh = await getConversation(reference!)
          await resolveRefinement({ scope: { sessionId: fresh.sessionId, draftId: fresh.draftId, expectedRevision: fresh.revision }, proposalId: prepared.id, action: 'abandon' })
        } catch { setErrors(previous => ({ ...previous, [id]: 'The prepared change remains unresolved. Keep current edits to resolve it without replacing them.' })) }
      }
      setErrors(previous => ({ ...previous, [id]: formatError(cause) }))
    } finally {
      try { await refresh?.() }
      catch (cause) { setErrors(previous => ({ ...previous, [id]: previous[id] ?? `Conversation refresh failed. ${formatError(cause)} Review the saved conversation before another action.` })) }
      running.current.delete(id); setPending(new Set(running.current))
    }
  }

  async function onUpdate(id: string, capturedReference?: ChatRef) {
    if (running.current.has(id)) return
    running.current.add(id); setPending(new Set(running.current))
    setErrors(previous => { const next = { ...previous }; delete next[id]; return next })
    const invocation = live.current
    const current = capturedReference ? invocation.conversations.bind(capturedReference).snapshot().chat : invocation.chat.chat
    const reference = current ? { sessionId: current.sessionId, draftId: current.draftId } : null
    let finish: (() => void) | undefined
    try {
      const proposal = current?.proposals?.find(item => item.id === id)
      if (!proposal || !reference || proposal.target.kind === 'session') throw new Error('This proposal is unavailable.')
      const checked = local(proposal)
      if (proposal.state.kind !== 'applied' && checked.key !== editorKey(proposal.before)) throw new Error('The editor changed. Your edits are retained. Request a fresh suggestion.')
      finish = invocation.persistence.coordination.beginRecordOperation()
      const result = await applyRefinement({ reference, proposalId: id })
      const saved = result.updated.record
      const ctx = live.current
      const coordination = ctx.persistence.coordination
      const intents = checked.kind === 'finding' ? coordination.findingIntents : coordination.draftIntents
      const intent = intents.get(saved.id)
      if (ctx.session.activeSessionIdRef.current === saved.sessionId && intent?.kind !== 'delete'
        && ((intent?.generation ?? 0) === checked.generation || intent?.kind === 'discard')) {
        const row = (checked.kind === 'finding' ? ctx.records.findingsRef.current : ctx.records.draftsRef.current).find(item => item.id === saved.id)
        if (row) {
          const dirty = checked.kind === 'finding' ? ctx.records.dirtyFindingIdsRef.current : ctx.records.dirtyDraftIdsRef.current
          const unchanged = !dirty.has(saved.id) || (editorKey(editorValue(row)) === checked.key
            && (proposal.state.kind !== 'applied' || checked.key === editorKey(proposal.before) || checked.key === editorKey(proposal.after)))
          coordination.clearStage(checked.kind, saved.id)
          if (result.updated.kind === 'finding') {
            ctx.records.savedFindingsRef.current = coordination.replaceRecord(ctx.records.savedFindingsRef.current, result.updated.record)
            if (unchanged) {
              ctx.records.dirtyFindingIdsRef.current.delete(saved.id)
              const next = coordination.replaceRecord(ctx.records.findingsRef.current, result.updated.record)
              ctx.records.findingsRef.current = next; ctx.records.setFindings(next)
            }
          } else {
            ctx.records.savedDraftsRef.current = coordination.replaceRecord(ctx.records.savedDraftsRef.current, result.updated.record)
            if (unchanged) {
              ctx.records.dirtyDraftIdsRef.current.delete(saved.id)
              const next = coordination.replaceRecord(ctx.records.draftsRef.current, result.updated.record)
              ctx.records.draftsRef.current = next; ctx.records.setDrafts(next)
            }
          }
          ctx.feedback.setNotice(unchanged ? result.updated.kind === 'finding' ? 'Finding updated' : 'Test case updated' : 'Record updated. Your newer editor changes are still unsaved.')
        }
      }
    } catch (cause) {
      setErrors(previous => ({ ...previous, [id]: `${formatError(cause)} You can retry Update safely.` }))
    } finally {
      finish?.()
      if (reference) {
        try { await invocation.conversations.bind(reference).refresh() }
        catch { setErrors(previous => ({ ...previous, [id]: previous[id] ?? 'Could not refresh the conversation. Reopen it to check the saved result.' })) }
      }
      running.current.delete(id); setPending(new Set(running.current))
    }
  }

  useEffect(() => context.persistence.coordination.subscribeChanges((kind, recordId, reason, origin) => {
    refreshActivity(value => value + 1)
    if (!reason || !origin) return
    if (reason === 'conflict') setErrors(previous => ({ ...previous, [origin.proposalId]: 'Stored record changed. Your local changes are retained. Use the record editor Discard control to review the newer saved record.' }))
    void refreshOrigin(origin, reason).catch(cause => setErrors(previous => ({ ...previous, [origin.proposalId]: formatError(cause) })))
    async function refreshOrigin(captured: StageOrigin, event: 'saved' | 'discard' | 'conflict') {
      const chat = await getConversation(captured.reference)
      const proposal = chat.proposals?.find(item => item.id === captured.proposalId)
      if (event === 'discard' && proposal?.state.kind === 'staged' && proposal.state.stage.id === captured.stageId) {
        await resolveRefinement({ scope: { ...captured.reference, expectedRevision: chat.revision }, proposalId: captured.proposalId, action: 'discard' })
      }
      await context.conversations.bind(captured.reference).refresh()
    }
    void kind; void recordId
  }), [context.persistence, context.chat, context.conversations])
  const preparedOnly = new Set((context.chat.chat?.proposals ?? []).filter(item => item.state.kind === 'staged' && item.target.kind !== 'session' && context.persistence.coordination.proposalStages.get(`${item.target.kind === 'finding' ? 'finding' : 'draft'}:${item.target.snapshot.recordId}`)?.id !== (item.state.kind === 'staged' ? item.state.stage.id : undefined)).map(item => item.id))
  const controls: ProposalControls = { errors, pending, onAction, onUpdate, preparedOnly }
  const recordWritesPending = context.persistence.coordination.hasPendingRecordCompensations()
  return { recordWritesPending, proposalControls: controls }
}
