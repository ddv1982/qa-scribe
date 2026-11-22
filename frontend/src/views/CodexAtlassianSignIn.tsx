import { useEffect, useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { getCodexAtlassianStatus, signInCodexAtlassian, signOutCodexAtlassian, type CodexAtlassianStatus } from '../tauri'
import { formatError } from '../ui/format'

type Activity =
  | { kind: 'checking' | 'signingIn' | 'signingOut' }
  | { kind: 'idle' }
  | { kind: 'failed', message: string }

const busyLabels = { checking: 'Checking…', signingIn: 'Finish signing in in your browser (up to 5 minutes)…', signingOut: 'Signing out…' }

/** Codex's own Atlassian sign-in for Jira and Confluence lookups. */
export function CodexAtlassianSignIn() {
  // The last known sign-in survives a failed action, so a failed sign-out
  // still offers Sign out again.
  const [known, setKnown] = useState<CodexAtlassianStatus | null>(null)
  const [activity, setActivity] = useState<Activity>({ kind: 'checking' })

  function settle(action: Promise<CodexAtlassianStatus>, isActive: () => boolean = () => true) {
    action
      .then((status) => { if (isActive()) { setKnown(status); setActivity({ kind: 'idle' }) } })
      .catch((cause: unknown) => { if (isActive()) setActivity({ kind: 'failed', message: formatError(cause) }) })
  }

  useEffect(() => {
    let active = true
    settle(getCodexAtlassianStatus(), () => active)
    return () => { active = false }
  }, [])

  function run(kind: 'signingIn' | 'signingOut', action: () => Promise<CodexAtlassianStatus>) {
    setActivity({ kind })
    settle(action())
  }

  const busy = activity.kind === 'checking' || activity.kind === 'signingIn' || activity.kind === 'signingOut'
  const signedIn = known === 'signedIn'
  const status = busy
    ? busyLabels[activity.kind]
    : activity.kind === 'failed'
      ? activity.message
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
