import { useEffect, useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { getCodexAtlassianStatus, signInCodexAtlassian, signOutCodexAtlassian, type CodexAtlassianStatus } from '../tauri'
import { formatError } from '../ui/format'

type SignInState =
  | { kind: 'checking' | 'signingIn' | 'signingOut' }
  | { kind: 'known', status: CodexAtlassianStatus }
  | { kind: 'failed', message: string }

const busyLabels = { checking: 'Checking…', signingIn: 'Finish signing in in your browser (up to 5 minutes)…', signingOut: 'Signing out…' }

/** Codex's own Atlassian sign-in for Jira and Confluence lookups. */
export function CodexAtlassianSignIn() {
  const [state, setState] = useState<SignInState>({ kind: 'checking' })

  useEffect(() => {
    let active = true
    getCodexAtlassianStatus()
      .then((status) => { if (active) setState({ kind: 'known', status }) })
      .catch((cause: unknown) => { if (active) setState({ kind: 'failed', message: formatError(cause) }) })
    return () => { active = false }
  }, [])

  function run(kind: 'signingIn' | 'signingOut', action: () => Promise<CodexAtlassianStatus>) {
    setState({ kind })
    action()
      .then((status) => setState({ kind: 'known', status }))
      .catch((cause: unknown) => setState({ kind: 'failed', message: formatError(cause) }))
  }

  const busy = state.kind === 'checking' || state.kind === 'signingIn' || state.kind === 'signingOut'
  const signedIn = state.kind === 'known' && state.status === 'signedIn'
  const status = busy
    ? busyLabels[state.kind]
    : state.kind === 'failed'
      ? state.message
      : signedIn ? 'Signed in' : 'Not signed in'

  return (
    <div className="codex-atlassian-sign-in">
      <span>
        Codex Atlassian sign-in: <span role="status">{status}</span>
      </span>
      {signedIn
        ? <ActionButton variant="quiet" type="button" disabled={busy} onClick={() => run('signingOut', signOutCodexAtlassian)}>Sign out</ActionButton>
        : <ActionButton variant="secondary" type="button" disabled={busy} onClick={() => run('signingIn', signInCodexAtlassian)}>Sign in for Codex</ActionButton>}
    </div>
  )
}
