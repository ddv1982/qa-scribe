import { useCallback, useEffect, useRef, useState } from 'react'
import { copyAttachmentImageToClipboard } from '../tauri'
import { copyRecordForJira, managedAttachmentReferencesForClipboard } from '../editor/clipboardExport'
import { formatError } from '../ui/format'

type CopyAction = 'jira-text' | 'screenshot'
export type CopyTarget =
  | Readonly<{ kind: 'note'; sessionId: string; action: CopyAction }>
  | Readonly<{ kind: 'draft' | 'finding'; sessionId: string; id: string; action: CopyAction }>
export type ClipboardSnapshot = Readonly<{ target: CopyTarget; title: string; bodyHtml: string }>
export type CopyState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'pending' | 'succeeded'; snapshot: ClipboardSnapshot }>
  | Readonly<{ status: 'failed'; snapshot: ClipboardSnapshot; error: string }>

export function copyMatchesSnapshot(state: CopyState, snapshot: ClipboardSnapshot): boolean {
  if (state.status === 'idle') return false
  const captured = state.snapshot
  const left = captured.target
  const right = snapshot.target
  return left.kind === right.kind && left.sessionId === right.sessionId && left.action === right.action
    && (left.kind === 'note' || (right.kind !== 'note' && left.id === right.id))
    && captured.title === snapshot.title && captured.bodyHtml === snapshot.bodyHtml
}

export function useCopyActions() {
  const [copyState, setCopyState] = useState<CopyState>({ status: 'idle' })
  const alive = useRef(false)
  const inFlight = useRef(false)
  const successTimer = useRef<number | null>(null)
  const attempt = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (successTimer.current !== null) window.clearTimeout(successTimer.current)
      successTimer.current = null
    }
  }, [])

  const copy = useCallback(async (input: ClipboardSnapshot): Promise<void> => {
    if (inFlight.current || !alive.current) return
    const target = input.target.kind === 'note'
      ? Object.freeze({ kind: input.target.kind, sessionId: input.target.sessionId, action: input.target.action })
      : Object.freeze({ kind: input.target.kind, sessionId: input.target.sessionId, id: input.target.id, action: input.target.action })
    const snapshot: ClipboardSnapshot = Object.freeze({ target, title: input.title, bodyHtml: input.bodyHtml })
    inFlight.current = true
    const currentAttempt = ++attempt.current
    if (successTimer.current !== null) window.clearTimeout(successTimer.current)
    successTimer.current = null
    setCopyState({ status: 'pending', snapshot })
    try {
      if (snapshot.target.action === 'jira-text') {
        await copyRecordForJira(snapshot)
      } else {
        const [first] = managedAttachmentReferencesForClipboard(snapshot)
        if (!first) throw new Error('No screenshot found in this record.')
        await copyAttachmentImageToClipboard(first.attachmentId)
      }
      if (!alive.current || attempt.current !== currentAttempt) return
      setCopyState({ status: 'succeeded', snapshot })
      successTimer.current = window.setTimeout(() => {
        if (alive.current && attempt.current === currentAttempt) setCopyState({ status: 'idle' })
        successTimer.current = null
      }, 1800)
    } catch (cause) {
      if (alive.current && attempt.current === currentAttempt) setCopyState({ status: 'failed', snapshot, error: formatError(cause) })
    } finally {
      inFlight.current = false
    }
  }, [])

  return { copy, copyState }
}
