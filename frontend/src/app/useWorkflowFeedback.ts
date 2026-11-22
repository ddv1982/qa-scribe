import { useCallback, useState, type SetStateAction } from 'react'
import type { BusyAction } from '../ui/types'
import type { Notice, WorkflowFeedback } from './types'

export function useWorkflowFeedback() {
  const [busyAction, setBusyAction] = useState<BusyAction | null>('boot')
  const [text, setText] = useState<string | null>(null)
  const [warning, setWarningText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A warning stays until the next notice replaces it.
  const setNotice = useCallback((value: SetStateAction<string | null>) => {
    setWarningText(null)
    setText(value)
  }, [])
  const setWarning = useCallback((message: string) => setWarningText(message), [])
  const notice: Notice = warning ? { warning } : text
  const feedback: WorkflowFeedback = { setBusyAction, setNotice, setWarning, setError }
  return { busyAction, notice, error, setBusyAction, setNotice, setWarning, setError, feedback }
}
