import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { getSettings, listRecentSessions, listSessions, type AppSettings, type Session } from '../tauri'
import { formatError } from '../ui/format'
import type { BusyAction } from '../ui/types'
import { markFirstPaintAfterBoot, startupMark, startupMeasure } from './startupTelemetry'

const STARTUP_SESSION_LIMIT = 50

type UseAppStartupOptions = {
  loadSettings: (settings: AppSettings) => void
  openSession: (session: Session, showNotice?: boolean) => Promise<void>
  reconcileActiveJobs: () => Promise<void>
  loadProviderStatus: () => Promise<void>
  refreshProviderStatus: () => Promise<void>
  saveSettingsDraft: () => Promise<void>
  setSessions: Dispatch<SetStateAction<Session[]>>
  setSessionLibraryComplete: Dispatch<SetStateAction<boolean>>
  setBusyAction: Dispatch<SetStateAction<BusyAction | null>>
  setNotice: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

export function useAppStartup(options: UseAppStartupOptions) {
  const optionsRef = useRef(options)
  const bootedRef = useRef(false)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const loadProviderStatusAfterBoot = useCallback(async () => {
    const { loadProviderStatus, refreshProviderStatus, setError } = optionsRef.current
    try {
      await loadProviderStatus()
      startupMark('provider-fast-status-complete')
      startupMeasure('boot-to-provider-fast-status', 'boot-start', 'provider-fast-status-complete')
      window.setTimeout(() => {
        void refreshProviderStatus()
          .then(() => {
            startupMark('provider-deep-refresh-complete')
            startupMeasure('boot-to-provider-deep-refresh', 'boot-start', 'provider-deep-refresh-complete')
          })
          .catch((cause) => setError(formatError(cause)))
      }, 0)
    } catch (cause) {
      setError(formatError(cause))
    }
  }, [])

  const boot = useCallback(async () => {
    const {
      loadSettings,
      openSession,
      reconcileActiveJobs,
      setSessions,
      setSessionLibraryComplete,
      setBusyAction,
      setNotice,
      setError,
    } = optionsRef.current

    try {
      startupMark('boot-start')
      setBusyAction('boot')
      setError(null)
      const settingsRequest = getSettings().then((settings) => {
        startupMark('settings-loaded')
        startupMeasure('boot-to-settings-loaded', 'boot-start', 'settings-loaded')
        return settings
      })
      const sessionsRequest = listRecentSessions(STARTUP_SESSION_LIMIT).then((sessions) => {
        startupMark('sessions-loaded')
        startupMeasure('boot-to-sessions-loaded', 'boot-start', 'sessions-loaded')
        return sessions
      })
      const [settings, sessions] = await Promise.all([settingsRequest, sessionsRequest])
      loadSettings(settings)
      setSessions(sessions)
      setSessionLibraryComplete(sessions.length < STARTUP_SESSION_LIMIT)
      bootedRef.current = true
      if (sessions[0]) {
        await openSession(sessions[0], false)
        startupMark('first-session-opened')
        startupMeasure('boot-to-first-session-opened', 'boot-start', 'first-session-opened')
      } else {
        setNotice('Create a note to start')
        startupMark('empty-session-library-ready')
        startupMeasure('boot-to-empty-session-library-ready', 'boot-start', 'empty-session-library-ready')
      }
      void reconcileActiveJobs()
      window.setTimeout(() => {
        void loadProviderStatusAfterBoot()
      }, 0)
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
      startupMark('boot-busy-cleared')
      startupMeasure('boot-to-busy-cleared', 'boot-start', 'boot-busy-cleared')
      markFirstPaintAfterBoot()
    }
  }, [loadProviderStatusAfterBoot])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void boot()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [boot])

  const handleLoadSessionLibrary = useCallback(async () => {
    const { setSessions, setSessionLibraryComplete, setBusyAction, setNotice, setError } = optionsRef.current
    try {
      setBusyAction('load-session-library')
      setError(null)
      setSessions(await listSessions())
      setSessionLibraryComplete(true)
      setNotice('Session Library loaded')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }, [])

  const handleRefreshProviderStatus = useCallback(async () => {
    const { refreshProviderStatus, setBusyAction, setNotice, setError } = optionsRef.current
    try {
      setBusyAction('refresh-providers')
      setError(null)
      await refreshProviderStatus()
      startupMark('provider-deep-refresh-complete')
      startupMeasure('boot-to-provider-deep-refresh', 'boot-start', 'provider-deep-refresh-complete')
      setNotice('Provider status refreshed')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }, [])

  const handleSaveSettings = useCallback(async () => {
    const { saveSettingsDraft, setBusyAction } = optionsRef.current
    try {
      setBusyAction('save-settings')
      await saveSettingsDraft()
    } finally {
      setBusyAction(null)
    }
  }, [])

  return {
    bootedRef,
    handleLoadSessionLibrary,
    handleRefreshProviderStatus,
    handleSaveSettings,
  }
}
