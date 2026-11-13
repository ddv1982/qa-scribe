import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { beginRecordChat, beginTestRunChat, listChatHistory, type ChatHistoryEntry, type ChatRef, type ChatTarget, type ConversationOwner, type ConversationRecord, type StageOrigin } from '../tauri'
import type { MainView } from '../ui/types'
import { formatError } from '../ui/format'
import { captureRecordContext, type RecordChatSelection, type ChatContextPresentation } from './sessionChat.context'
import type { RecordWorkspace } from './types'
import type { ConversationEngine } from './sessionChat.actions'
import { sameReference } from './sessionChat.workspaces'
import { presentRun, unfinishedConversations, sameOwner, sameRecord, type AskAiOwner, type RecordRevealRequest, type ShownTestRun, type SourcePresentation, type UnfinishedConversation } from './conversationPresentation'
import type { RecordLoadState } from './useRecordHydration'

type RecordOwner = Extract<ConversationOwner, { kind: 'record' }>
type Panel = { owner: AskAiOwner; reference: ChatRef | null; open: boolean; closeError?: string; recoveryReason?: string; focusRequest: number; legacyOrigin?: StageOrigin }
  & ({ phase: 'preparing' } | { phase: 'ready' } | { phase: 'error'; error: string; blockedReference?: ChatRef })
type Launch = { reference: ChatRef; owner: AskAiOwner; pending: { promise: Promise<void>; current: () => boolean } | null }
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

function presentSource(owner: AskAiOwner, sessionId: string | null, records: RecordWorkspace, ctx: Context, selection: RecordChatSelection | null, shown: ShownTestRun | null): SourcePresentation {
  if (owner.sessionId !== sessionId) return { kind: 'loading' }
  if (owner.kind === 'test_run') return presentRun(owner, shown)
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
  /** The test run on the run screen, told by the Test cases view. */
  const [shownRun, setShownRunState] = useState<ShownTestRun | null>(null)
  const shownRunRef = useRef<ShownTestRun | null>(null)
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
    if (owner?.kind === 'notes' || owner?.kind === 'test_run') return { kind: 'session' }
    if (owner?.kind === 'record') return captureRecordContext(sendSessionId, owner.record, current.records)
    return current.view !== 'sessions' && selected.current ? captureRecordContext(sendSessionId, selected.current, current.records) : { kind: 'session' }
  }
  function captureNotesContext(sendSessionId: string): ChatTarget {
    const current = panelRef.current
    if (current?.open && current.legacyOrigin && current.owner.kind === 'record' && current.owner.sessionId === sendSessionId) {
      if (sourceFor(current.owner).kind !== 'available') throw new Error('Reload the original source before sending a new message.')
      return captureRecordContext(sendSessionId, current.owner.record, live.current.records)
    }
    return capture(sendSessionId)
  }
  function sourceFor(owner: AskAiOwner): SourcePresentation {
    const current = live.current
    return presentSource(owner, current.sessionId, current.records, current.ctx, selected.current, shownRunRef.current)
  }
  /** Told by the Test cases view which test run its run screen shows. Showing another run, or none, closes a run's panel. */
  function onShowRun(next: ShownTestRun | null) {
    const previous = shownRunRef.current
    shownRunRef.current = next
    setShownRunState(next)
    if (previous?.runId === next?.runId && previous?.sessionId === next?.sessionId) return
    ++openingEpoch.current
    const current = panelRef.current
    if (current?.open && current.owner.kind === 'test_run' && (current.owner.runId !== next?.runId || current.owner.sessionId !== next.sessionId)) setPanel({ ...current, open: false })
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
      if (current?.open && (!target || current.owner.kind !== 'record' || !sameRecord(current.owner.record, target))) setPanel({ ...current, open: false })
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
    const flushed = await ctx.conversations.flushInputs()
    if (openingEpoch.current !== epoch || panelRef.current !== current) return
    if (!flushed) {
      setPanel({ ...current, closeError: 'Some conversation input could not be saved. Resolve failed saves or images in the affected conversation, then try Close again.' })
      return
    }
    setPanel({ ...current, open: false, closeError: undefined })
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
      if (owner.kind === 'test_run') {
        // The run screen is where a test run conversation lives; it is not revealed from elsewhere.
        if (sourceFor(owner).kind === 'unavailable') throw new Error('Open this test run to continue its conversation.')
        await ctx.conversations.select(reference)
        if (!current() || !sameOwner(handle.snapshot().chat?.owner, owner)) return
        setPanel({ owner, recoveryReason, reference, open: true, focusRequest: (panelRef.current?.focusRequest ?? 0) + 1, phase: 'ready' })
        void refreshRecovery()
        return
      }
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
    return launchOwner({ kind: 'record', sessionId, record: { kind: target.kind, recordId: target.recordId } })
  }
  function onAskAiRun(runId: string) {
    if (!sessionId) return Promise.resolve()
    return launchOwner({ kind: 'test_run', sessionId, runId })
  }
  function launchOwner(owner: AskAiOwner) {
    const previous = panelRef.current
    const handle = previous?.reference ? ctx.conversations.bind(previous.reference) : null
    if (previous?.open && previous.phase === 'ready' && sameOwner(previous.owner, owner) && handle) {
      setPanel({ ...previous, focusRequest: previous.focusRequest + 1 }); return Promise.resolve()
    }
    const key = JSON.stringify(owner)
    let launch = attempts.current.get(key)
    if (launch?.pending?.current()) return launch.pending.promise
    const earlier = launch?.pending?.promise
    if (!launch) { launch = { owner, reference: { sessionId: owner.sessionId, draftId: crypto.randomUUID() }, pending: null }; attempts.current.set(key, launch) }
    const captured = launch
    const epoch = ++openingEpoch.current
    const recordEpoch = selectionEpoch.current
    const current = () => openingEpoch.current === epoch && selectionEpoch.current === recordEpoch && live.current.sessionId === owner.sessionId
    const preparing: Extract<Panel, { phase: 'preparing' }> = { owner, reference: null, open: true, focusRequest: previous?.focusRequest ?? 0, phase: 'preparing' }
    setPanel(preparing)
    const pending = (async () => {
      try {
        await earlier
        if (!current()) return
        if (!await ctx.conversations.flushInputs()) throw new Error('Your earlier input could not be saved. Return to its conversation before starting another chat.')
        if (!current()) return
        const rows = await listChatHistory({ kind: 'session', sessionId: owner.sessionId })
        if (!current()) return
        setRecoveryRows(rows.filter(row => row.unresolvedStages.length || ['running', 'failed', 'interrupted', 'cancelled'].includes(row.lastTurnStatus ?? '')))
        const unfinished = unfinishedConversations(rows, ctx.conversations.attention(owner.sessionId)).find(item => sameOwner(item.owner, owner))
        if (unfinished) { attempts.current.delete(key); await openConversation(unfinished.reference, unfinished.origin, unfinished.reason, preparing); return }
        const bound = ctx.conversations.bind(captured.reference)
        const chat = bound.snapshot().chat ?? await (owner.kind === 'record'
          ? beginRecordChat({ ...captured.reference, record: owner.record }) : beginTestRunChat({ ...captured.reference, runId: owner.runId }))
        if (!sameReference(chat, captured.reference) || !sameOwner(chat.owner, owner)) throw new Error('Creation returned an unexpected conversation.')
        await bound.refresh()
        if (!current()) { void refreshRecovery(); return }
        await ctx.conversations.select(captured.reference)
        if (!current()) return
        if (attempts.current.get(key) === captured) attempts.current.delete(key)
        setPanel({ owner, reference: captured.reference, open: true, focusRequest: (previous?.focusRequest ?? 0) + 1, phase: 'ready' })
        void refreshRecovery()
      } catch (cause) {
        if (current()) setPanel(previous?.reference && sameOwner(previous.owner, owner) ? { ...previous, open: true, phase: 'error', error: formatError(cause) }
          : { owner, reference: null, open: true, focusRequest: 0, phase: 'error', error: formatError(cause), blockedReference: previous?.reference ?? undefined })
      }
    })().finally(() => { if (captured.pending?.promise === pending) captured.pending = null })
    captured.pending = { promise: pending, current }
    return pending
  }
  const current = panel?.owner.sessionId === sessionId ? panel : null
  const source = current ? presentSource(current.owner, sessionId, records, ctx, selection, shownRun) : null
  const recordView = view === 'findings' || view === 'testware'
  const owner = current?.owner
  // A test run's panel shows only beside its own run screen.
  const visible = Boolean(current?.open && (owner?.kind === 'test_run' ? view === 'testware' && shownRun?.runId === owner.runId : recordView))
  const context: ChatContextPresentation = owner?.kind === 'record' ? { ...owner.record, title: source?.kind === 'available' ? source.title : 'Unavailable source', unsaved: source?.kind === 'available' && source.unsaved }
    : owner ? { kind: 'session' } : selection && recordView ? selection : { kind: 'session' }
  const attention = sessionId ? ctx.conversations.attention(sessionId) : []
  return {
    invalidateNavigation,
    selectionEpoch, visible,
    openRecordId: visible && owner?.kind === 'record' ? owner.record.recordId : null,
    openRunId: visible && owner?.kind === 'test_run' ? owner.runId : null,
    focusRequest: current?.focusRequest ?? 0, panel: current, reference: current?.reference ?? null, source,
    context, contextError: source?.kind === 'unavailable' ? 'This record is no longer available in this Session.' : source?.kind === 'error' ? source.message : null,
    capture, captureNotesContext, onAskAi, onAskAiRun, onShowRun, onSelectRecord, close, openConversation, openStage: (origin: StageOrigin) => openConversation(origin.reference, origin), revealRequest, acknowledgeReveal,
    retrySource: () => { if (owner?.kind === 'record') ctx.retrySource(owner.record); else shownRun?.retry() },
    // A test run conversation is recovered from its run screen through Ask AI, not from the Session bar.
    recovery: unfinishedConversations(recoveryRows.filter(row => row.reference.sessionId === sessionId), attention).filter(isRecordRecovery), recoveryError,
    recover: (item: UnfinishedConversation) => openConversation(item.reference, item.origin, item.reason),
  }
}

function isRecordRecovery(item: UnfinishedConversation): item is UnfinishedConversation & { owner: RecordOwner } {
  return item.owner.kind === 'record'
}
