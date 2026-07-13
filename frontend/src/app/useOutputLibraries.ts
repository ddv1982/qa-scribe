import { useCallback, useEffect, useState } from 'react'
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

  const loadDraftLibrary = useCallback(async () => {
    setDraftLibraryState('loading')
    setDraftLibraryError(null)
    try {
      setDraftLibrary(await listDraftLibrary())
      setDraftLibraryState('ready')
    } catch (cause) {
      setDraftLibraryError(formatError(cause))
      setDraftLibraryState('error')
    }
  }, [])

  const loadFindingLibrary = useCallback(async () => {
    setFindingLibraryState('loading')
    setFindingLibraryError(null)
    try {
      setFindingLibrary(await listFindingLibrary())
      setFindingLibraryState('ready')
    } catch (cause) {
      setFindingLibraryError(formatError(cause))
      setFindingLibraryState('error')
    }
  }, [])

  useEffect(() => {
    if (activeView !== 'testware-library') return
    const timeout = window.setTimeout(() => void loadDraftLibrary(), 0)
    return () => window.clearTimeout(timeout)
  }, [activeView, loadDraftLibrary])

  useEffect(() => {
    if (activeView !== 'findings-library') return
    const timeout = window.setTimeout(() => void loadFindingLibrary(), 0)
    return () => window.clearTimeout(timeout)
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
