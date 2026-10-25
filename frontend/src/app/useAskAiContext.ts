import { useLayoutEffect, useRef, useState } from 'react'
import type { ChatTarget, ConversationOwner } from '../bindings'
import type { MainView } from '../ui/types'
import { captureRecordContext, type RecordChatSelection, type ChatContextPresentation } from './sessionChat.context'
import type { RecordWorkspace } from './types'

type ItemPanel = { sessionId: string; target: RecordChatSelection | null; open: boolean; expanded: boolean; focusRequest: number }

export function useAskAiContext(sessionId: string | null, view: MainView, records: RecordWorkspace) {
  const [panel, setPanel] = useState<ItemPanel | null>(null)
  const current = panel?.sessionId === sessionId ? panel : null
  const recordView = view === 'findings' || view === 'testware'
  const visible = Boolean(current?.open && recordView)
  const selectionEpoch = useRef(0)
  const selectedIdentity = useRef<string | null>(null)
  useLayoutEffect(() => { ++selectionEpoch.current }, [sessionId, view])
  function capture(sendSessionId: string, owner?: ConversationOwner | null): ChatTarget {
    if (owner?.kind === 'record') return captureRecordContext(sendSessionId, owner.record, records)
    if (sessionId !== sendSessionId) throw new Error('The active Session changed before sending.')
    if (view === 'sessions' || panel?.sessionId !== sendSessionId || !panel?.target) return { kind: 'session' }
    return captureRecordContext(sendSessionId, panel.target, records)
  }
  function currentSelection(target: RecordChatSelection): RecordChatSelection {
    const dirty = target.kind === 'finding' ? records.dirtyFindingIdsRef : records.dirtyDraftIdsRef
    return { ...target, unsaved: dirty.current.has(target.recordId) }
  }
  function onAskAi(target: RecordChatSelection) {
    ++selectionEpoch.current
    if (!sessionId) return
    selectedIdentity.current = JSON.stringify([sessionId, target.kind, target.recordId])
    setPanel(previous => ({ sessionId, target: currentSelection(target), open: true, expanded: false, focusRequest: (previous?.focusRequest ?? 0) + 1 }))
  }
  function onSelectRecord(selection: RecordChatSelection) {
    const identity = JSON.stringify([sessionId, selection.kind, selection.recordId])
    if (selectedIdentity.current !== identity) { ++selectionEpoch.current; selectedIdentity.current = identity }
    const target = currentSelection(selection)
    setPanel(previous => previous?.sessionId === sessionId && previous.open && previous.target
      && JSON.stringify(previous.target) !== JSON.stringify(target)
      ? { ...previous, target } : previous)
  }
  const selectedRecord = current?.target && (current.target.kind === 'finding' ? records.findings : records.drafts)
    .find(record => record.id === current.target?.recordId && record.sessionId === sessionId)
  const context: ChatContextPresentation = view === 'sessions' || !current?.target ? { kind: 'session' } : current.target
  const contextError = recordView && current?.target && !selectedRecord ? 'This record is no longer available in this Session. Detach context or select another record.' : null
  return {
    selectionEpoch, visible, expanded: visible && Boolean(current?.expanded), focusRequest: current?.focusRequest ?? 0,
    context, contextError, capture, onAskAi, onSelectRecord,
    close: () => { ++selectionEpoch.current; setPanel(previous => previous ? { ...previous, open: false, expanded: false } : previous) },
    toggleExpanded: () => setPanel(previous => previous ? { ...previous, expanded: !previous.expanded } : previous),
    detach: () => { ++selectionEpoch.current; setPanel(previous => previous ? { ...previous, target: null } : previous) },
  }
}
