import { useCallback, useEffect, useRef, useState } from 'react'
import { commands } from '../bindings'
import { writePlainClipboard } from '../editor/clipboardExport'
import { formatError, toCommandError } from '../ui/format'

export const SIGN_IN_COMMAND = 'az login'
export const pendingMessages = {
  subscriptions: 'Loading Azure subscriptions…',
  components: 'Loading Application Insights resources…',
  signIn: 'Complete sign-in in your browser.',
  cancellingSignIn: 'Cancelling Azure CLI sign-in…',
}

export function useAzureLogDiscovery() {
  const [pending, setPending] = useState<keyof typeof pendingMessages | null>(null)
  const [error, setError] = useState<{ message: string; canSignIn: boolean } | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const active = useRef<{ id: string; cancelling: boolean } | null>(null)
  const cancelRequest = useCallback(() => {
    const request = active.current
    active.current = null
    if (request) void commands.cancelApplicationLogQuery(request.id).catch(() => {})
  }, [])

  useEffect(() => cancelRequest, [cancelRequest])

  const load = useCallback(async <T,>(
    stage: Exclude<keyof typeof pendingMessages, 'cancellingSignIn'>,
    request: (id: string) => Promise<T>,
    onResult: (result: T) => void,
  ) => {
    if (stage === 'signIn' && active.current) return
    cancelRequest()
    const operation = { id: crypto.randomUUID(), cancelling: false }
    active.current = operation
    setPending(stage)
    setError(null)
    setCopyStatus('')
    try {
      const result = await request(operation.id)
      if (active.current !== operation || operation.cancelling) return
      active.current = null
      setPending(null)
      onResult(result)
    } catch (cause) {
      if (active.current === operation && !operation.cancelling) setError({
        message: formatError(cause),
        canSignIn: stage === 'signIn' || toCommandError(cause).kind === 'azureCliSignedOut',
      })
    } finally {
      if (active.current === operation) {
        active.current = null
        setPending(null)
        if (operation.cancelling) setError({ message: 'Azure CLI sign-in was cancelled.', canSignIn: true })
      }
    }
  }, [cancelRequest])

  function cancelSignIn() {
    const operation = active.current
    if (!operation || operation.cancelling) return
    operation.cancelling = true
    setPending('cancellingSignIn')
    void commands.cancelApplicationLogQuery(operation.id).catch(() => {})
  }

  async function copySignInCommand() {
    try {
      await writePlainClipboard(SIGN_IN_COMMAND)
      setCopyStatus('Command copied.')
    } catch {
      setCopyStatus('Could not copy the command.')
    }
  }

  return { pending, error, copyStatus, load, cancelRequest, cancelSignIn, copySignInCommand,
    signingIn: pending === 'signIn' || pending === 'cancellingSignIn' }
}
