import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useRecordSelection } from './useRecordSelection'

it('keeps the record navigation asked for while the view has no record to show yet', () => {
  const { result } = renderHook(() => useRecordSelection())
  act(() => result.current.focusRecord('findings', 'finding-old'))
  act(() => result.current.selectRecord.findings(null))
  expect(result.current.selectedRecordIds.findings).toBe('finding-old')
  act(() => result.current.selectRecord.findings('finding-new'))
  expect(result.current.selectedRecordIds).toEqual({ testware: null, findings: 'finding-new' })
})
