import { useState } from 'react'
import { ApplicationLogDiscovery } from './ApplicationLogDiscovery'
import { ActionButton } from '../components/ActionButton'
import { commands, type ApplicationLogAccess, type ApplicationLogSource } from '../bindings'
import { formatError } from '../ui/format'

const accessMessages: Record<ApplicationLogAccess, string> = {
  ready: 'Azure CLI can query this target.',
  unsupported: 'Application logs are available on macOS and Linux.',
  cliMissing: 'Install Azure CLI (az) and try again.',
  extensionMissing: 'Run az extension add --name application-insights and try again.',
  signedOut: 'Run az login and try again.',
  accessDenied: 'Azure denied access to this target.',
  failed: 'Could not query this target. Check the resource ID and Azure CLI setup.',
  timedOut: 'The Azure CLI access check timed out.',
}

const MAX_SOURCES = 20

export function ApplicationLogsSettings({ sources, onChange, askAiEnabled, onAskAiChange }: {
  sources: ApplicationLogSource[]
  askAiEnabled?: boolean
  onAskAiChange?: (enabled: boolean) => void
  onChange: (sources: ApplicationLogSource[]) => void
}) {
  const atCapacity = sources.length >= MAX_SOURCES
  return (
    <section className="wide-setting" id="application-log-settings">
      <h2>Application logs</h2>
      <p className="settings-note">Configure Application Insights targets for test run evidence. Captures are stored locally. Copy report includes the target, UTC window, row count and a portal link containing the query.</p>
      <ApplicationLogDiscovery sources={sources} disabled={atCapacity}
        onAdd={(source) => onChange([...sources, source])} />
      <ActionButton variant="secondary" disabled={atCapacity}
        onClick={() => onChange([...sources, { label: '', resourceId: '' }])}>Enter resource ID manually</ActionButton>
      {sources.map((source, index) => (
        <SourceFields key={index} source={source} index={index}
          onChange={(next) => onChange(sources.map((previous, i) => i === index ? next : previous))}
          onRemove={() => onChange(sources.filter((_, i) => i !== index))} />
      ))}
      {onAskAiChange ? <label className="read-source-option">
        <input type="checkbox" checked={askAiEnabled ?? false} onChange={(event) => onAskAiChange(event.target.checked)} />
        <span>Allow Ask AI to request application logs</span>
        <span className="settings-note">Claude Code and Codex can request log queries during test runs on macOS and Linux. Each query requires your approval before results are shared with the provider.</span>
      </label> : null}
    </section>
  )
}

function SourceFields({ source, index, onChange, onRemove }: {
  source: ApplicationLogSource
  index: number
  onChange: (source: ApplicationLogSource) => void
  onRemove: () => void
}) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ source: ApplicationLogSource, message: string } | null>(null)

  async function check() {
    setChecking(true)
    setResult(null)
    try {
      const status = await commands.checkApplicationLogAccess(source)
      setResult({ source, message: accessMessages[status] })
    } catch (cause) {
      setResult({ source, message: formatError(cause) })
    } finally {
      setChecking(false)
    }
  }

  return (
    <fieldset className="read-source-fieldset">
      <legend>Source {index + 1}</legend>
      <label className="field">
        <span>Source label</span>
        <input value={source.label} onChange={(event) => onChange({ ...source, label: event.target.value })} />
      </label>
      <label className="field">
        <span>Application Insights resource ID</span>
        <input value={source.resourceId} onChange={(event) => onChange({ ...source, resourceId: event.target.value })} />
      </label>
      <ActionButton variant="secondary" loading={checking} disabled={!source.resourceId.trim() || !source.label.trim()}
        onClick={() => void check()}>Check access</ActionButton>
      <ActionButton variant="quiet" onClick={onRemove}>Remove source</ActionButton>
      {result?.source === source ? <p role="status">{result.message}</p> : null}
    </fieldset>
  )
}
