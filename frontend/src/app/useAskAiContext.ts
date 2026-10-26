import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { beginRecordChat, listChatHistory, type ChatHistoryEntry, type ChatRef, type ChatTarget, type ConversationOwner, type ConversationRecord, type StageOrigin } from '../tauri'
import type { MainView } from '../ui/types'
import { formatError } from '../ui/format'
import { captureRecordContext, type RecordChatSelection, type ChatContextPresentation } from './sessionChat.context'
import type { RecordWorkspace } from './types'
import type { ConversationEngine } from './sessionChat.actions'
import { sameReference } from './sessionChat.workspaces'
import { unfinishedConversations, sameOwner, sameRecord, type RecordRevealRequest, type SourcePresentation } from './conversationPresentation'
import type { RecordLoadState } from './useRecordHydration'

type RecordOwner = Extract<ConversationOwner, { kind: 'record' }>
type Panel = { owner: RecordOwner; reference: ChatRef | null; open: boolean; recoveryReason?: string; focusRequest: number; legacyOrigin?: StageOrigin }
  & ({ phase: 'preparing' } | { phase: 'ready' } | { phase: 'error'; error: string; blockedReference?: ChatRef })
type Launch = { reference: ChatRef; owner: RecordOwner; pending: Promise<void> | null }
type Context = {
  conversations: ConversationEngine
  findingLoadState: RecordLoadState; draftLoadState: RecordLoadState
  findingLoadError: string | null; draftLoadError: string | null
  findingSourceIds: ReadonlySet<string> | null; draftSourceIds: ReadonlySet<string> | null
  retrySource: (record: ConversationRecord) => void
  revealOwner: (owner: ConversationOwner, reveal: (() => Promise<boolean>) | null, recoverInput?: boolean, preserveEditor?: boolean) => Promise<boolean>
  openNotes: () => void
  restoredReference?: ChatRef | null
}

function presentSource(owner: RecordOwner, sessionId: string | null, records: RecordWorkspace, ctx: Context, selection: RecordChatSelection | null): SourcePresentation {
  if (owner.sessionId !== sessionId) return { kind: 'loading' }
  const state = owner.record.kind === 'finding' ? ctx.findingLoadState : ctx.draftLoadState
  if (state === 'idle' || state === 'loading') return { kind: 'loading' }
  if (state === 'error') return { kind: 'error', message: (owner.record.kind === 'finding' ? ctx.findingLoadError : ctx.draftLoadError) ?? 'The source could not be loaded.' }
  const sourceIds = owner.record.kind === 'finding' ? ctx.findingSourceIds : ctx.draftSourceIds
  if (sourceIds && !sourceIds.has(owner.record.recordId)) return { kind: 'unavailable' }
  const record = (owner.record.kind === 'finding' ? records.findings : records.drafts.filter(row => row.kind === 'testware')).find(row => row.id === owner.record.recordId && row.sessionId === owner.sessionId)
  return record ? { kind: 'available', title: record.title, unsaved: Boolean(sameRecord(selection, owner.record) && selection?.unsaved) } : { kind: 'unavailable' }
}

export function useAskAiContext(sessionId: string | null, view: MainView, records: RecordWorkspace, ctx: Context) {
  const [panel, setPanelState] = useState<Panel | null>(null)
  const panelRef = useRef(panel)
  function setPanel(next: Panel | null) { panelRef.current = next; setPanelState(next) }
  const live = useRef({ sessionId, view, records, ctx })
  useLayoutEffect(() => { live.current = { sessionId, view, records, ctx } })
  const selectionEpoch = useRef(0)
  const openingEpoch = useRef(0)
  const [selection, setSelection] = useState<RecordChatSelection | null>(null)
  const selected = useRef<RecordChatSelection | null>(null)
  const attempts = useRef(new Map<string, Launch>())
  const revealWaiter = useRef<{ request: RecordRevealRequest; finish: (accepted: boolean) => void } | null>(null)
  const [revealRequest, setRevealRequest] = useState<RecordRevealRequest | null>(null)
  const internalReveal = useRef<number | null>(null)
  const [recoveryRows, setRecoveryRows] = useState<ChatHistoryEntry[]>([])
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [, changed] = useState(0)
  const recoveryEpoch = useRef(0)
  useEffect(() => ctx.conversations.subscribeAttention(() => changed(value => value + 1)), [ctx.conversations])
  useLayoutEffect(() => () => {
    ++selectionEpoch.current
    if (!internalReveal.current) { ++openingEpoch.current; if (panelRef.current) setPanel({ ...panelRef.current, open: false }) }
    selected.current = null
  }, [sessionId, view])
  function invalidateNavigation() {
    ++openingEpoch.current; ++selectionEpoch.current
    internalReveal.current = null
    const waiter = revealWaiter.current
    revealWaiter.current = null; setRevealRequest(null); waiter?.finish(false)
  }
  useLayoutEffect(() => invalidateNavigation, [sessionId])
  async function refreshRecovery() {
    const active = live.current.sessionId
    const epoch = ++recoveryEpoch.current
    if (!active) { setRecoveryRows([]); return }
    try {
      const rows = await listChatHistory({ kind: 'session', sessionId: active })
      if (live.current.sessionId === active && recoveryEpoch.current === epoch) { setRecoveryRows(rows.filter(row => row.unresolvedStages.length || ['running', 'failed', 'interrupted', 'cancelled'].includes(row.lastTurnStatus ?? ''))); setRecoveryError(null) }
    } catch (cause) { if (live.current.sessionId === active && recoveryEpoch.current === epoch) setRecoveryError(formatError(cause)) }
  }
  useEffect(() => { void Promise.resolve().then(() => { setRecoveryRows([]); return refreshRecovery() }) }, [sessionId])
  useEffect(() => {
    const reference = ctx.restoredReference
    if (!reference || reference.sessionId !== sessionId) return
    let current = true
    const handle = ctx.conversations.bind(reference)
    void handle.refresh().then(() => {
      const chat = handle.snapshot().chat
      if (current && chat?.owner.kind === 'record' && sameReference(chat, reference) && chat.owner.sessionId === sessionId && !panelRef.current) {
        setPanel({ owner: chat.owner, reference, open: false, focusRequest: 0, phase: 'ready' })
      }
    }).catch(() => undefined)
    return () => { current = false }
  }, [ctx.conversations, ctx.restoredReference, sessionId])

  function capture(sendSessionId: string, owner?: ConversationOwner | null): ChatTarget {
    const current = live.current
    if (current.sessionId !== sendSessionId) throw new Error('The active Session changed before sending.')
    if (owner?.kind === 'notes') return { kind: 'session' }
    if (owner?.kind === 'record') return captureRecordContext(sendSessionId, owner.record, current.records)
    return current.view !== 'sessions' && selected.current ? captureRecordContext(sendSessionId, selected.current, current.records) : { kind: 'session' }
  }
  function captureNotesContext(sendSessionId: string): ChatTarget {
    const current = panelRef.current
    if (current?.open && current.legacyOrigin && current.owner.sessionId === sendSessionId) {
      if (sourceFor(current.owner).kind !== 'available') throw new Error('Reload the original source before sending a new message.')
      return captureRecordContext(sendSessionId, current.owner.record, live.current.records)
    }
    return capture(sendSessionId)
  }
  function sourceFor(owner: RecordOwner): SourcePresentation {
    const current = live.current
    return presentSource(owner, current.sessionId, current.records, current.ctx, selected.current)
  }
  function onSelectRecord(target: RecordChatSelection | null, requestId?: string) {
    if (target) {
      const dirty = target.kind === 'finding' ? live.current.records.dirtyFindingIdsRef : live.current.records.dirtyDraftIdsRef
      target = { ...target, unsaved: dirty.current.has(target.recordId) }
    }
    const identityChanged = selected.current === null || target === null ? selected.current !== target : !sameRecord(selected.current, target)
    selected.current = target
    setSelection(previous => JSON.stringify(previous) === JSON.stringify(target) ? previous : target)
    if (identityChanged) ++selectionEpoch.current
    const revealing = requestId && revealRequest?.requestId === requestId
    if (revealing && !revealWaiter.current) setRevealRequest(null)
    if (identityChanged && !revealing && !internalReveal.current) {
      ++openingEpoch.current
      const current = panelRef.current
      if (current?.open && (!target || !sameRecord(current.owner.record, target))) setPanel({ ...current, open: false })
    }
  }
  function acknowledgeReveal(request: RecordRevealRequest) {
    const waiter = revealWaiter.current
    if (!waiter || waiter.request.requestId !== request.requestId || request.sessionId !== live.current.sessionId
      || !sameRecord(waiter.request.record, request.record) || !sameRecord(selected.current, request.record)) return
    revealWaiter.current = null; setRevealRequest(null); waiter.finish(true)
  }
  useEffect(() => {
    const waiter = revealWaiter.current
    if (!waiter) return
    const state = sourceFor({ kind: 'record', sessionId: waiter.request.sessionId, record: waiter.request.record })
    if (state.kind === 'unavailable' || state.kind === 'error') {
      void Promise.resolve().then(() => { if (revealWaiter.current === waiter) { revealWaiter.current = null; waiter.finish(true) } })
    }
  }, [revealRequest, ctx.findingLoadState, ctx.draftLoadState, ctx.findingLoadError, ctx.draftLoadError, records, sessionId])
  async function close() {
    const epoch = ++openingEpoch.current
    const current = panelRef.current
    if (!current) return
    if (!await ctx.conversations.flushInputs()) return
    if (openingEpoch.current === epoch && panelRef.current === current) setPanel({ ...current, open: false })
    await refreshRecovery()
  }
  async function openConversation(reference: ChatRef, origin?: StageOrigin, recoveryReason = 'Unfinished conversation', launchPanel?: Extract<Panel, { phase: 'preparing' }>) {
    const epoch = ++openingEpoch.current
    const active = live.current.sessionId
    const current = () => openingEpoch.current === epoch && live.current.sessionId === active && reference.sessionId === active
    const handle = ctx.conversations.bind(reference)
    function fail(cause: unknown) {
      if (!current()) return
      const error = formatError(cause)
      setRecoveryError(error)
      if (launchPanel && panelRef.current === launchPanel) setPanel({ ...launchPanel, phase: 'error', error })
    }
    try {
      await handle.refresh()
      const chat = handle.snapshot().chat
      if (!current() || !chat || !sameReference(chat, reference) || chat.owner.sessionId !== active) return
      const owner = chat.owner
      if (origin && (!sameReference(origin.reference, reference) || !chat.proposals?.some(proposal => proposal.id === origin.proposalId && proposal.state.kind === 'staged' && proposal.state.stage.id === origin.stageId && proposal.target.kind === origin.record.kind && proposal.target.snapshot.recordId === origin.record.recordId))) throw new Error('The prepared change is no longer available.')
      const sourceOwner: RecordOwner | null = origin ? { kind: 'record', sessionId: reference.sessionId, record: origin.record } : owner.kind === 'record' ? owner : null
      internalReveal.current = epoch
      const sourceView = sourceOwner?.record.kind === 'finding' ? 'findings' : 'testware'
      const reveal = sourceOwner && (live.current.view !== sourceView || sourceFor(sourceOwner).kind !== 'unavailable') ? () => new Promise<boolean>(finish => {
        const request = { requestId: crypto.randomUUID(), sessionId: sourceOwner.sessionId, record: sourceOwner.record }
        revealWaiter.current?.finish(false); revealWaiter.current = { request, finish }; setRevealRequest(request)
      }) : null
      let accepted: boolean
      try { accepted = await ctx.revealOwner(sourceOwner ?? owner, reveal, Boolean(handle.snapshot().error || handle.snapshot().imageFailures.length), Boolean(sourceOwner && sameRecord(selected.current, sourceOwner.record))) }
      finally { if (internalReveal.current === epoch) internalReveal.current = null }
      if (!accepted || !current()) return
      await ctx.conversations.select(reference)
      if (!current() || !sameOwner(handle.snapshot().chat?.owner, owner)) return
      if (!sourceOwner) { setPanel(null); ctx.openNotes(); return }
      setPanel({ owner: sourceOwner, legacyOrigin: origin, recoveryReason, reference, open: true, focusRequest: (panelRef.current?.focusRequest ?? 0) + 1, phase: 'ready' })
      void refreshRecovery()
    } catch (cause) { fail(cause) }
    finally { if (launchPanel && panelRef.current === launchPanel) fail(new Error('The retained conversation could not be opened. Try Ask AI again.')) }
  }
  function onAskAi(target: RecordChatSelection) {
    if (!sessionId) return Promise.resolve()
    const owner: RecordOwner = { kind: 'record', sessionId, record: { kind: target.kind, recordId: target.recordId } }
    const previous = panelRef.current
    const handle = previous?.reference ? ctx.conversations.bind(previous.reference) : null
    if (previous?.open && previous.phase === 'ready' && sameOwner(previous.owner, owner) && handle) {
      setPanel({ ...previous, focusRequest: previous.focusRequest + 1 }); return Promise.resolve()
    }
    const key = JSON.stringify(owner)
    let launch = attempts.current.get(key)
    if (launch?.pending) return launch.pending
    if (!launch) { launch = { owner, reference: { sessionId, draftId: crypto.randomUUID() }, pending: null }; attempts.current.set(key, launch) }
    const captured = launch
    const epoch = ++openingEpoch.current
    const recordEpoch = selectionEpoch.current
    const current = () => openingEpoch.current === epoch && selectionEpoch.current === recordEpoch && live.current.sessionId === owner.sessionId
    const preparing: Extract<Panel, { phase: 'preparing' }> = { owner, reference: null, open: true, focusRequest: previous?.focusRequest ?? 0, phase: 'preparing' }
    setPanel(preparing)
    const pending = (async () => {
      try {
        if (!await ctx.conversations.flushInputs()) throw new Error('Your earlier input could not be saved. Return to its conversation before starting another chat.')
        if (!current()) return
        const rows = await listChatHistory({ kind: 'session', sessionId: owner.sessionId })
        if (!current()) return
        setRecoveryRows(rows.filter(row => row.unresolvedStages.length || ['running', 'failed', 'interrupted', 'cancelled'].includes(row.lastTurnStatus ?? '')))
        const unfinished = unfinishedConversations(rows, ctx.conversations.attention(owner.sessionId)).find(item => sameOwner(item.owner, owner))
        if (unfinished) { attempts.current.delete(key); await openConversation(unfinished.reference, unfinished.origin, unfinished.reason, preparing); return }
        const chat = await beginRecordChat({ ...captured.reference, record: owner.record })
        if (!sameReference(chat, captured.reference) || !sameOwner(chat.owner, owner)) throw new Error('Creation returned an unexpected conversation.')
        const bound = ctx.conversations.bind(captured.reference)
        await bound.refresh()
        attempts.current.delete(key)
        if (!current()) { void refreshRecovery(); return }
        await ctx.conversations.select(captured.reference)
        if (!current()) return
        setPanel({ owner, reference: captured.reference, open: true, focusRequest: (previous?.focusRequest ?? 0) + 1, phase: 'ready' })
        void refreshRecovery()
      } catch (cause) {
        if (current()) setPanel(previous?.reference && sameOwner(previous.owner, owner) ? { ...previous, open: true, phase: 'error', error: formatError(cause) }
          : { owner, reference: null, open: true, focusRequest: 0, phase: 'error', error: formatError(cause), blockedReference: previous?.reference ?? undefined })
      }
    })().finally(() => { captured.pending = null })
    captured.pending = pending
    return pending
  }
  const current = panel?.owner.sessionId === sessionId ? panel : null
  const source = current ? presentSource(current.owner, sessionId, records, ctx, selection) : null
  const recordView = view === 'findings' || view === 'testware'
  const context: ChatContextPresentation = current ? { ...current.owner.record, title: source?.kind === 'available' ? source.title : 'Unavailable source', unsaved: source?.kind === 'available' && source.unsaved } : selection && recordView ? selection : { kind: 'session' }
  const attention = sessionId ? ctx.conversations.attention(sessionId) : []
  return {
    invalidateNavigation,
    selectionEpoch, visible: Boolean(current?.open && recordView),
    focusRequest: current?.focusRequest ?? 0, panel: current, reference: current?.reference ?? null, source,
    context, contextError: source?.kind === 'unavailable' ? 'This record is no longer available in this Session.' : source?.kind === 'error' ? source.message : null,
    capture, captureNotesContext, onAskAi, onSelectRecord, close, openConversation, openStage: (origin: StageOrigin) => openConversation(origin.reference, origin), revealRequest, acknowledgeReveal,
    retrySource: () => { if (current) ctx.retrySource(current.owner.record) },
    recovery: unfinishedConversations(recoveryRows.filter(row => row.reference.sessionId === sessionId), attention), recoveryError,
    recover: (item: import('./conversationPresentation').UnfinishedConversation) => openConversation(item.reference, item.origin, item.reason),
  }
}
