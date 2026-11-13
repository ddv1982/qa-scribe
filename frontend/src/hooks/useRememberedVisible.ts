import { useState } from 'react'

/** One choice for every screen that lists records beside the open one: Test cases, Findings and both libraries. */
export const recordListStorageKey = 'qa-scribe-record-list'
/** Whether the Note shows beside a new Finding or test cases draft. */
export const creationNoteStorageKey = 'qa-scribe-creation-note'

function storedVisible(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) !== 'hidden'
  } catch {
    return true
  }
}

/** Whether a part of the screen is shown, remembered across screens and restarts; shown until the person hides it. */
export function useRememberedVisible(storageKey: string): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = useState(() => storedVisible(storageKey))
  const remember = (next: boolean) => {
    setVisible(next)
    try {
      window.localStorage.setItem(storageKey, next ? 'shown' : 'hidden')
    } catch {
      // Without storage the choice still holds until the screen closes.
    }
  }
  return [visible, remember]
}
