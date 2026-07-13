import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { BusyAction } from '../ui/types'
import type { CopiedTarget, CopyFeedback, WorkflowFeedback } from './types'

export function useWorkflowFeedback() {
  const [busyAction, setBusyAction] = useState<BusyAction | null>('boot')
  const [copiedTarget, setCopiedTarget] = useState<CopiedTarget | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const copySuccessResetRef = useRef<number | null>(null)

  useEffect(() => {
    return () => clearCopySuccessTimeout(copySuccessResetRef)
  }, [])

  const feedback: WorkflowFeedback = { setBusyAction, setNotice, setError }
  const copyFeedback: CopyFeedback = { copySuccessResetRef, setCopiedTarget }
  return { busyAction, copiedTarget, notice, error, setBusyAction, setNotice, setError, feedback, copyFeedback }
}

function clearCopySuccessTimeout(timeoutRef: MutableRefObject<number | null>) {
  if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
}
