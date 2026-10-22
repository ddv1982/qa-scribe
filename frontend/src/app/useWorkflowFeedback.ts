import { useState } from 'react'
import type { BusyAction } from '../ui/types'
import type { WorkflowFeedback } from './types'

export function useWorkflowFeedback() {
  const [busyAction, setBusyAction] = useState<BusyAction | null>('boot')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const feedback: WorkflowFeedback = { setBusyAction, setNotice, setError }
  return { busyAction, notice, error, setBusyAction, setNotice, setError, feedback }
}
