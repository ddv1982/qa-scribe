import { useEffect, useRef, useState } from 'react'
import { getConversation, listFindings, listDrafts, resolveRefinement, type ChatRef, type StageOrigin, type RefinementAction, type RefinementProposal, type RecordWriteGuard } from '../tauri'
import { parseRichEditorDocument, preserveManagedImageNodes, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { sameReference } from './sessionChat.workspaces'
import { editorKey, editorValue, recordWriteGuard } from './recordWriteGuards'
import { formatError } from '../ui/format'
import type { SessionChatViewState } from './sessionChat.types'
import type { RecordActionsContext } from './recordActions'
import type { useRecordActions } from './recordActions'
import type { ProposalSaveResult, SavedRecord, RecordPersistence } from './recordPersistence'
import type { useAskAiContext } from './useAskAiContext'
import type { CreatedRecordEditTarget, RecordWorkspace } from './types'

type RecordUpdateConfirmation = { reference: ChatRef; key: string; editEpoch: number; selectionEpoch: number; conversationEpoch: number }

export type RecordUpdateResult = Exclude<ProposalSaveResult, { kind: 'saved' }> | { kind: 'saved'; record: SavedRecord; refresh: 'ok' | 'failed' }

export type ProposalControls = {
  applyUnavailable?: string
  errors: Readonly<Record<string, string>>
  pending: ReadonlySet<string>
  preparedOnly?: ReadonlySet<string>
  updated?: ReadonlySet<string>
  unconfirmed?: ReadonlySet<string>
  abandoned?: ReadonlySet<string>
  onUpdate?: (proposalId: string, reference?: ChatRef) => Promise<RecordUpdateResult>
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
  const [confirmations, setConfirmations] = useState<ReadonlyMap<string, RecordUpdateConfirmation>>(new Map())
  const running = useRef(new Set<string>())
  const updates = useRef(new Map<string, Promise<RecordUpdateResult>>())
  const unconfirmed = useRef(new Map<string, { record: SavedRecord; origin: StageOrigin }>())
  const [unconfirmedIds, setUnconfirmedIds] = useState<ReadonlySet<string>>(new Set())
  const [abandoned, setAbandoned] = useState<ReadonlySet<string>>(new Set())
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [, refreshActivity] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => context.conversations.observeProposalUpdates(() => [...unconfirmed.current.values()].map(update => update.origin)), [context.conversations])

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

  function onUpdate(id: string, capturedReference?: ChatRef): Promise<RecordUpdateResult> {
    const existing = updates.current.get(id)
    if (existing) return existing
    const completion = update(id, capturedReference).finally(() => { updates.current.delete(id) })
    updates.current.set(id, completion)
    return completion
  }

  async function update(id: string, capturedReference?: ChatRef): Promise<RecordUpdateResult> {
    if (running.current.has(id)) return { kind: 'failed', message: 'This proposal already has an action in progress.' }
    running.current.add(id); setPending(new Set(running.current))
    setErrors(previous => { const next = { ...previous }; delete next[id]; return next })
    const invocation = live.current
    const current = capturedReference ? invocation.conversations.bind(capturedReference).snapshot().chat : invocation.chat.chat
    const reference = current ? { sessionId: current.sessionId, draftId: current.draftId } : null
    const epoch = invocation.askAi.selectionEpoch.current
    const conversationEpoch = invocation.conversations.selectionEpoch()
    const selected = () => sameReference(live.current.chat.chat, reference) && live.current.askAi.selectionEpoch.current === epoch
      && invocation.conversations.selectionEpoch() === conversationEpoch
    let prepared: RefinementProposal | undefined
    let installed = false
    const fail = (message: string, kind: 'failed' | 'unconfirmed' = 'failed'): RecordUpdateResult => {
      setErrors(previous => ({ ...previous, [id]: message }))
      return { kind, message }
    }
    try {
      const proposal = current?.proposals?.find(item => item.id === id)
      if (!reference || !current || !proposal || current.submission || proposal.target.kind === 'session') throw new Error('This record proposal is unavailable.')
      const checked = local(proposal)
      const coordination = invocation.persistence.coordination
      const key = `${checked.kind}:${checked.record.id}`
      let editEpoch = coordination.localEditEpochs.get(key) ?? 0
      let expectedKey = checked.key
      const intents = checked.kind === 'finding' ? coordination.findingIntents : coordination.draftIntents
      const rows = () => checked.kind === 'finding' ? live.current.records.findingsRef.current : live.current.records.draftsRef.current
      const saved = () => (checked.kind === 'finding' ? live.current.records.savedFindingsRef.current : live.current.records.savedDraftsRef.current).find(row => row.id === checked.record.id)
      const base = saved()
      const pin = coordination.latestWriteGuards.get(key)
      const isCurrent = () => selected() && live.current.session.activeSessionIdRef.current === checked.record.sessionId
        && (coordination.localEditEpochs.get(key) ?? 0) === editEpoch
        && rows().some(row => row.id === checked.record.id && row.sessionId === checked.record.sessionId && editorKey(editorValue(row)) === expectedKey)
      const ownsPreparation = () => isCurrent() && (intents.get(checked.record.id)?.generation ?? 0) === checked.generation
        && saved() === base && coordination.latestWriteGuards.get(key) === pin && coordination.proposalStages.get(key) === checked.association
      const fresh = await getConversation(reference)
      if (!sameReference(fresh, reference) || fresh.submission || !ownsPreparation()) throw new Error('The selection or editor changed. Your newer edits are retained. Review again before updating.')
      const subject = fresh.proposals?.find(item => item.id === id)
      if (!subject || subject.target.kind !== proposal.target.kind || subject.target.snapshot.recordId !== checked.record.id
        || editorKey(subject.after) !== editorKey(proposal.after) || editorKey(subject.before) !== editorKey(proposal.before)) throw new Error('The reviewed proposal changed. Request a fresh refinement.')
      const unknown = unconfirmed.current.get(id)
      if (unknown) {
        if (!sameReference(unknown.origin.reference, reference)) throw new Error('Open the original conversation to check this update.')
        const stored = (await (checked.kind === 'finding' ? listFindings(reference.sessionId) : listDrafts(reference.sessionId))).find(row => row.id === unknown.record.id)
        if (!ownsPreparation()) throw new Error('The selection or editor changed while checking the earlier update. Your newer edits are retained.')
        if (stored && subject.state.kind === 'staged' && subject.state.stage.id === unknown.origin.stageId) {
          const storedGuard = await recordWriteGuard(stored, checked.kind === 'finding' ? 'findings' : 'drafts')
          if (ownsPreparation() && storedGuard.expectedStoredBase === checked.base.expectedStoredBase) {
            unconfirmed.current.delete(id)
            return fail('No saved update was found. Your edits are retained. Select Update again to retry the exact proposal.')
          }
        }
        if (!stored || subject.state.kind !== 'saved' || subject.state.stage.id !== unknown.origin.stageId
          || editorKey(editorValue(stored)) !== editorKey(editorValue(unknown.record))) return fail('Update is still unconfirmed. Reopen the saved conversation and record before taking another action.', 'unconfirmed')
        coordination.bindStage(checked.kind, stored.id, stored.sessionId, { ...subject.state.stage, origin: unknown.origin })
        const reconciled = await invocation.persistence.persistProposalExact({ ...unknown, isCurrent }, stored)
        if (reconciled.kind !== 'saved') return reconciled.kind === 'failed' || reconciled.kind === 'unconfirmed' ? fail(reconciled.message, reconciled.kind) : reconciled
        unconfirmed.current.delete(id)
        let refresh: 'ok' | 'failed' = 'ok'
        try { await invocation.conversations.bind(reference).refresh() } catch { refresh = 'failed' }
        if (!isCurrent()) return { kind: 'superseded', committed: stored }
        setConfirmations(previous => new Map(previous).set(id, { reference, key: expectedKey, editEpoch, selectionEpoch: epoch, conversationEpoch }))
        invocation.askAi.onSelectRecord({ kind: proposal.target.kind, recordId: stored.id, title: stored.title, unsaved: false })
        invocation.feedback.setNotice(refresh === 'ok' ? checked.kind === 'finding' ? 'Finding updated' : 'Test case updated' : 'Save confirmed, but conversation refresh failed. Reopen this conversation.')
        return { kind: 'saved', record: reconciled.record, refresh }
      }
      if (subject.state.kind !== 'offered' && subject.state.kind !== 'staged') throw new Error('This proposal no longer has an update to save.')
      const alreadyInstalled = subject.state.kind === 'staged' && checked.association?.id === subject.state.stage.id && checked.key === editorKey(subject.after)
      installed = alreadyInstalled
      if (!alreadyInstalled && checked.key !== editorKey(subject.before)) throw new Error('The local editor changed. Your newer edits are retained. Request a fresh refinement.')
      const staged = await resolveRefinement({ scope: { ...reference, expectedRevision: fresh.revision }, proposalId: id, action: 'stage' })
      const resolved = staged.proposals?.find(item => item.id === id)
      if (resolved?.state.kind !== 'staged') throw new Error('Update preparation failed. No staged proposal was returned.')
      prepared = resolved
      if (!ownsPreparation() || !sameReference(staged, reference) || editorKey(resolved.after) !== editorKey(subject.after)) throw new Error('The selection or editor changed while preparing Update. Your newer edits are retained.')
      const value = resolved.state.stage.after
      const document = parseRichEditorDocument(value.documentJson)
      const before = parseRichEditorDocument(resolved.before.documentJson)
      if (!document || !before) throw new Error('The proposed document is unavailable.')
      const body = richEditorDocumentToStoredBody(preserveManagedImageNodes(before, document))
      const record: SavedRecord = { ...checked.record, title: value.title, ...body, metadataJson: value.metadataJson }
      if (editorKey(editorValue(record)) !== editorKey(resolved.after)) throw new Error('The displayed proposal cannot be saved exactly. Request a fresh refinement.')
      const origin: StageOrigin = { reference, proposalId: id, stageId: resolved.state.stage.id,
        record: { kind: proposal.target.kind, recordId: checked.record.id } }
      coordination.bindStage(checked.kind, record.id, record.sessionId, { ...resolved.state.stage, origin })
      if (!alreadyInstalled) {
        if (checked.kind === 'finding') invocation.actions.updateLocalFinding(record.id, { title: record.title, ...body, metadataJson: record.metadataJson })
        else invocation.actions.updateLocalDraft(record.id, { title: record.title, ...body })
      }
      installed = true
      editEpoch = coordination.localEditEpochs.get(key) ?? 0
      expectedKey = editorKey(editorValue(record))
      const result = await invocation.persistence.persistProposalExact({ record, origin, isCurrent })
      if (result.kind === 'unconfirmed') unconfirmed.current.set(id, { record, origin })
      if (result.kind === 'failed' || result.kind === 'unconfirmed') return fail(result.message, result.kind)
      if (result.kind === 'conflict') { fail('Stored record changed. Your edits are retained. Use Discard to review the saved record.'); return result }
      if (result.kind === 'superseded') { fail('The selection or editor changed. Your newer edits are retained. Review the saved record before retrying.'); return result }
      let refresh: 'ok' | 'failed' = 'ok'
      try { await invocation.conversations.bind(reference).refresh() }
      catch { refresh = 'failed' }
      if (!isCurrent()) return { kind: 'superseded', committed: result.record }
      setConfirmations(previous => new Map(previous).set(id, { reference, key: expectedKey, editEpoch, selectionEpoch: epoch, conversationEpoch }))
      invocation.askAi.onSelectRecord({ kind: proposal.target.kind, recordId: record.id, title: result.record.title, unsaved: false })
      const label = checked.kind === 'finding' ? 'Finding updated' : 'Test case updated'
      invocation.feedback.setNotice(refresh === 'ok' ? label : `${label}. Save confirmed, but conversation refresh failed. Reopen this conversation to refresh it.`)
      if (refresh === 'failed') fail('Save confirmed, but conversation refresh failed. Reopen this conversation. Do not submit Update again.')
      return { ...result, refresh }
    } catch (cause) {
      if (prepared && !installed && reference) {
        try {
          const fresh = await getConversation(reference)
          await resolveRefinement({ scope: { ...reference, expectedRevision: fresh.revision }, proposalId: id, action: 'abandon' })
        } catch {
          return fail(`${formatError(cause)} The prepared change remains unresolved. Reopen its original conversation before trying another update.`)
        }
        setAbandoned(previous => new Set(previous).add(id))
        try { await invocation.conversations.bind(reference).refresh() }
        catch (refreshCause) {
          return fail(`${formatError(cause)} Prepared change was abandoned; your current edits were retained, but conversation refresh failed. ${formatError(refreshCause)} Reopen its original conversation to refresh it.`)
        }
      }
      return fail(formatError(cause))
    } finally {
      running.current.delete(id); setPending(new Set(running.current))
      setUnconfirmedIds(new Set(unconfirmed.current.keys()))
      invocation.conversations.proposalUpdatesChanged()
    }
  }

  useEffect(() => context.persistence.coordination.subscribeChanges((kind, recordId, reason, origin) => {
    refreshActivity(value => value + 1)
    if (!reason || !origin || updates.current.has(origin.proposalId)) return
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
  const updated = new Set((context.chat.chat?.proposals ?? []).filter(proposal => {
    const confirmation = confirmations.get(proposal.id)
    if (!confirmation || proposal.target.kind === 'session' || !sameReference(context.chat.chat, confirmation.reference)
      || context.askAi.selectionEpoch.current !== confirmation.selectionEpoch || context.conversations.selectionEpoch() !== confirmation.conversationEpoch) return false
    const kind = proposal.target.kind === 'finding' ? 'finding' : 'draft'
    const id = proposal.target.snapshot.recordId
    const record = (kind === 'finding' ? context.records.findingsRef.current : context.records.draftsRef.current).find(row => row.id === id)
    return record !== undefined && editorKey(editorValue(record)) === confirmation.key
      && (context.persistence.coordination.localEditEpochs.get(`${kind}:${id}`) ?? 0) === confirmation.editEpoch
  }).map(proposal => proposal.id))
  const controls: ProposalControls = { errors, pending, onAction, onUpdate, preparedOnly, updated, abandoned, unconfirmed: unconfirmedIds }
  const recordWritesPending = context.persistence.coordination.hasPendingRecordCompensations()
  return { recordWritesPending, proposalControls: controls }
}
