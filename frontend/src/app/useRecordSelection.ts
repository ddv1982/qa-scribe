import { useCallback, useMemo, useState } from 'react'
import type { MainView } from '../ui/types'

export type RecordView = 'testware' | 'findings'
type RecordSelection = Record<RecordView, string | null>

const isRecordView = (view: MainView): view is RecordView => view === 'testware' || view === 'findings'

/**
 * The record each record view shows. A view unmounts when another tab is open, so its selection is kept here:
 * returning to Test cases or Findings, or leaving a new draft, shows the record that was selected, not the newest.
 * `focusedRecordId` is the record navigation last opened, which the route names.
 */
export function useRecordSelection() {
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null)
  const [selectedRecordIds, setSelectedRecordIds] = useState<RecordSelection>({ testware: null, findings: null })
  const select = useCallback((view: RecordView, id: string | null) =>
    setSelectedRecordIds((previous) => previous[view] === id ? previous : { ...previous, [view]: id }), [])
  const selectRecord = useMemo(() => ({
    testware: (id: string | null) => select('testware', id),
    findings: (id: string | null) => select('findings', id),
  }), [select])
  const focusRecord = useCallback((view: MainView, id: string | null) => {
    setFocusedRecordId(id)
    if (isRecordView(view)) select(view, id)
  }, [select])
  return { focusedRecordId, selectedRecordIds, selectRecord, focusRecord }
}
