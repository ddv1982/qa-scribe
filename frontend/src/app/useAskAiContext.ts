import { useState } from 'react'
import type { ChatTarget } from '../bindings'
import type { MainView } from '../ui/types'
import { captureRecordContext, type RecordChatSelection, type ChatContextPresentation } from './sessionChat.context'
import type { RecordWorkspace } from './types'

type ItemPanel = { sessionId: string; target: RecordChatSelection | null; open: boolean; expanded: boolean; focusRequest: number }

export function useAskAiContext(sessionId: string | null, view: MainView, records: RecordWorkspace) {
  const [panel, setPanel] = useState<ItemPanel | null>(null)
  const current = panel?.sessionId === sessionId ? panel : null
  const recordView = view === 'findings' || view === 'testware'
  const visible = Boolean(current?.open && recordView)
  function capture(sendSessionId: string): ChatTarget {
    if (sessionId !== sendSessionId) throw new Error('The active Session changed before sending.')
    if (view === 'sessions' || panel?.sessionId !== sendSessionId || !panel?.target) return { kind: 'session' }
    return captureRecordContext(sendSessionId, panel.target, records)
  }
  function onAskAi(target: RecordChatSelection) {
    if (!sessionId) return
    setPanel(previous => ({ sessionId, target, open: true, expanded: false, focusRequest: (previous?.focusRequest ?? 0) + 1 }))
  }
  function onSelectRecord(target: RecordChatSelection) {
    setPanel(previous => previous?.sessionId === sessionId && previous.open && previous.target
      && JSON.stringify(previous.target) !== JSON.stringify(target)
      ? { ...previous, target } : previous)
  }
  const selectedRecord = current?.target && (current.target.kind === 'finding' ? records.findings : records.drafts)
    .find(record => record.id === current.target?.recordId && record.sessionId === sessionId)
  const context: ChatContextPresentation = view === 'sessions' || !current?.target ? { kind: 'session' } : current.target
  const contextError = recordView && current?.target && !selectedRecord ? 'This record is no longer available in this Session. Detach context or select another record.' : null
  return {
    visible, expanded: visible && Boolean(current?.expanded), focusRequest: current?.focusRequest ?? 0,
    context, contextError, capture, onAskAi, onSelectRecord,
    close: () => setPanel(previous => previous ? { ...previous, open: false, expanded: false } : previous),
    toggleExpanded: () => setPanel(previous => previous ? { ...previous, expanded: !previous.expanded } : previous),
    detach: () => setPanel(previous => previous ? { ...previous, target: null } : previous),
  }
}
