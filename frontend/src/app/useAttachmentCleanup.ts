import { useCallback, useEffect, useRef, useState } from 'react'
import { retryAttachmentCleanup, type AttachmentCleanupStatus } from '../tauri'
import { formatError } from '../ui/format'

export function useAttachmentCleanup(isBusy: boolean) {
  const [status, setStatus] = useState<AttachmentCleanupStatus | null>(null)
  const [lastKnownPendingFiles, setLastKnownPendingFiles] = useState<number | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const versionRef = useRef(0)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(false)

  const acceptStatus = useCallback((next: AttachmentCleanupStatus) => {
    // A committed delete is newer than any initial status request still running.
    versionRef.current += 1
    setStatus(next)
    if (next.pendingFiles !== null) setLastKnownPendingFiles(next.pendingFiles)
    setRetryError(null)
  }, [])

  const requestStatus = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const version = ++versionRef.current
    setRetrying(true)
    try {
      const next = await retryAttachmentCleanup()
      if (!mountedRef.current || version !== versionRef.current) return
      setStatus(next)
      if (next.pendingFiles !== null) setLastKnownPendingFiles(next.pendingFiles)
      setRetryError(null)
    } catch (cause) {
      if (mountedRef.current && version === versionRef.current) setRetryError(formatError(cause))
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) setRetrying(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    // Initial discovery performs one bounded retry, outside the boot barrier.
    const version = versionRef.current
    const timeout = window.setTimeout(() => {
      if (version === versionRef.current) void requestStatus()
    }, 0)
    return () => {
      window.clearTimeout(timeout)
      mountedRef.current = false
      versionRef.current += 1
    }
  }, [requestStatus])

  const retry = useCallback(async () => {
    if (isBusy) return
    await requestStatus()
  }, [isBusy, requestStatus])

  return { status, lastKnownPendingFiles, retryError, retrying, retryDisabled: isBusy || retrying, acceptStatus, retry }
}

export type AttachmentCleanupController = ReturnType<typeof useAttachmentCleanup>
