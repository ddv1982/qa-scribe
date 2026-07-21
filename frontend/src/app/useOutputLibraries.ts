import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listDraftLibrary,
  listFindingLibrary,
  type DraftLibraryItem,
  type FindingLibraryItem,
} from '../tauri'
import { formatError } from '../ui/format'
import type { MainView } from '../ui/types'

export type LibraryLoadState = 'idle' | 'loading' | 'ready' | 'error'

export function useOutputLibraries(activeView: MainView) {
  const [draftLibrary, setDraftLibrary] = useState<DraftLibraryItem[]>([])
  const [findingLibrary, setFindingLibrary] = useState<FindingLibraryItem[]>([])
  const [draftLibraryState, setDraftLibraryState] = useState<LibraryLoadState>('idle')
  const [findingLibraryState, setFindingLibraryState] = useState<LibraryLoadState>('idle')
  const [draftLibraryError, setDraftLibraryError] = useState<string | null>(null)
  const [findingLibraryError, setFindingLibraryError] = useState<string | null>(null)
  const draftLoadEpochRef = useRef(0)
  const findingLoadEpochRef = useRef(0)

  const loadDraftLibrary = useCallback(async () => {
    const loadEpoch = ++draftLoadEpochRef.current
    setDraftLibraryState('loading')
    setDraftLibraryError(null)
    try {
      const loaded = await listDraftLibrary()
      if (draftLoadEpochRef.current !== loadEpoch) return
      setDraftLibrary(loaded)
      setDraftLibraryState('ready')
    } catch (cause) {
      if (draftLoadEpochRef.current !== loadEpoch) return
      setDraftLibraryError(formatError(cause))
      setDraftLibraryState('error')
    }
  }, [])

  const loadFindingLibrary = useCallback(async () => {
    const loadEpoch = ++findingLoadEpochRef.current
    setFindingLibraryState('loading')
    setFindingLibraryError(null)
    try {
      const loaded = await listFindingLibrary()
      if (findingLoadEpochRef.current !== loadEpoch) return
      setFindingLibrary(loaded)
      setFindingLibraryState('ready')
    } catch (cause) {
      if (findingLoadEpochRef.current !== loadEpoch) return
      setFindingLibraryError(formatError(cause))
      setFindingLibraryState('error')
    }
  }, [])

  useEffect(() => {
    if (activeView !== 'testware-library') {
      draftLoadEpochRef.current += 1
      return
    }
    const timeout = window.setTimeout(() => void loadDraftLibrary(), 0)
    return () => {
      window.clearTimeout(timeout)
      draftLoadEpochRef.current += 1
    }
  }, [activeView, loadDraftLibrary])

  useEffect(() => {
    if (activeView !== 'findings-library') {
      findingLoadEpochRef.current += 1
      return
    }
    const timeout = window.setTimeout(() => void loadFindingLibrary(), 0)
    return () => {
      window.clearTimeout(timeout)
      findingLoadEpochRef.current += 1
    }
  }, [activeView, loadFindingLibrary])

  return {
    draftLibrary,
    draftLibraryError,
    draftLibraryState,
    findingLibrary,
    findingLibraryError,
    findingLibraryState,
    loadDraftLibrary,
    loadFindingLibrary,
  }
}
