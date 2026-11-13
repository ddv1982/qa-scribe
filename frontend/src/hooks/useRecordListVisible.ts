import { useState } from 'react'

/** One choice for every screen that lists records beside the open one: Test cases, Findings and both libraries. */
export const recordListStorageKey = 'qa-scribe-record-list'

function storedVisible(): boolean {
  try {
    return window.localStorage.getItem(recordListStorageKey) !== 'hidden'
  } catch {
    return true
  }
}

/** Whether the record list is shown, remembered across screens and restarts; shown until the person hides it. */
export function useRecordListVisible(): [boolean, () => void] {
  const [visible, setVisible] = useState(storedVisible)
  const toggle = () => {
    const next = !visible
    setVisible(next)
    try {
      window.localStorage.setItem(recordListStorageKey, next ? 'shown' : 'hidden')
    } catch {
      // Without storage the choice still holds until the screen closes.
    }
  }
  return [visible, toggle]
}
