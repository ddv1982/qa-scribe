import { AlertCircle, CheckCircle2, Clock3, Loader2 } from 'lucide-react'
import { originSummary } from '../settings/defaults'
import type {
  AiProvider,
  ProviderCatalogRollout,
  ProviderDefaultOrigin,
  ProviderDefaultSnapshot,
  ProviderDiscoveryState,
  ProviderModelCatalogSnapshot,
  ProviderState,
  ProviderStatus,
} from '../tauri'
import type { ProviderDiscoveryUiState } from '../ui/types'

export function defaultProviderLabel(defaultProvider: AiProvider, providerStatus?: ProviderStatus['providers'][number] | null): string {
  if (providerStatus) return providerStatus.label
  if (defaultProvider === 'claude_code') return 'Claude Code'
  if (defaultProvider === 'copilot_cli') return 'GitHub Copilot CLI'
  return 'Codex CLI'
}

export function providerCatalogSnapshot(
  provider: ProviderStatus['providers'][number] | null,
): ProviderModelCatalogSnapshot | null {
  return provider?.catalogSnapshot ?? null
}

export function catalogStatusDescription(
  provider: ProviderStatus['providers'][number] | null,
  catalog: ProviderModelCatalogSnapshot | null,
  rollout: ProviderCatalogRollout | null,
): string {
  if (rollout === 'disabled') return 'Using compatibility model choices. Structured catalog discovery is disabled.'
  if (!catalog || catalog.state === 'idle') return 'Model catalog not checked yet.'
  if (catalog.state === 'loading') return 'Checking the model catalog…'
  const rolloutSuffix = rollout === 'diagnostics'
    ? ' Compatibility model choices remain active while catalog diagnostics run.'
    : ''
  if (catalog.state === 'fresh') {
    const policySuffix = catalogContainsPolicyEntries(catalog) ? ' Policy-limited models remain visible.' : ''
    return `${catalogSourceDescription(catalog.source)} · checked ${formatCheckedAt(catalog.checkedAt)}.${policySuffix}${rolloutSuffix}`
  }
  if (catalog.state === 'stale') {
    return `${catalogSourceDescription(catalog.source)} · last checked ${formatCheckedAt(catalog.checkedAt)}. Refresh to confirm current access.${rolloutSuffix}`
  }
  return `${catalogRecoveryDescription(provider, catalog)}${rolloutSuffix}`
}

export function catalogSourceDescription(source: ProviderModelCatalogSnapshot['source']): string {
  if (source === 'cliCatalog') return 'Available for this account'
  if (source === 'cliHelp') return 'Recognized by the installed CLI'
  if (source === 'config' || source === 'environment') return 'Found in CLI configuration'
  return 'Static fallback'
}

function catalogRecoveryDescription(
  provider: ProviderStatus['providers'][number] | null,
  catalog: ProviderModelCatalogSnapshot,
): string {
  const providerLabel = provider?.label ?? 'the provider CLI'
  if (provider?.status === 'authRequired') return `Sign in with ${providerLabel}, then retry model discovery.`
  if (catalogContainsPolicyEntries(catalog) || catalog.warnings.some((warning) => warning.code.toLocaleLowerCase().includes('policy'))) {
    return 'Model access is controlled by account or organization policy. Refresh after policy changes.'
  }
  if (catalog.error?.code === 'authRequired') return `Sign in with ${providerLabel}, then retry model discovery.`
  if (catalog.error?.code === 'policyDenied') return 'Model access is controlled by account or organization policy. Refresh after policy changes.'
  if (catalog.error?.code === 'unsupported' || catalog.error?.code === 'protocolIncompatible') {
    return `Update ${providerLabel} to inspect account models. Custom model IDs remain available.`
  }
  if (['timedOut', 'unavailable', 'network'].includes(catalog.error?.code ?? '')) {
    return 'The account catalog is unavailable. Check sign-in and network access, then retry.'
  }
  if (catalog.error?.code === 'rateLimited') return 'Model discovery is temporarily rate limited. Retry later.'
  if (provider?.status === 'installRequired') return `Install or update ${providerLabel}, then retry.`
  return 'The model catalog could not be refreshed. Retry, or update the CLI if the problem continues.'
}

function catalogContainsPolicyEntries(catalog: ProviderModelCatalogSnapshot): boolean {
  return catalog.models.some((model) => model.availability === 'policyDisabled' || model.availability === 'unconfigured')
}

export function sanitizedProviderReason(provider: ProviderStatus['providers'][number]): string {
  if (provider.status === 'ready') return 'The local CLI is ready. Model discovery details are shown in the catalog status above.'
  if (provider.status === 'authRequired') return `Sign in with ${provider.label}, then refresh.`
  if (provider.status === 'installRequired') return `Install or update ${provider.label}, then refresh.`
  return `Refresh ${provider.label}. If the problem continues, update the CLI and check account policy or network access.`
}

export function sanitizedDiscoveryRecovery(code: string, providerLabel: string): string {
  if (code === 'authRequired') return `Sign in with ${providerLabel}, then retry.`
  if (code === 'policyDenied') return 'Check account or organization model policy, then retry.'
  if (['timedOut', 'unavailable', 'network'].includes(code)) return 'Check sign-in and network access, then retry.'
  if (code === 'rateLimited') return 'Retry later; model discovery is temporarily rate limited.'
  if (code === 'unsupported' || code === 'protocolIncompatible') return `Update ${providerLabel}, then retry.`
  if (code === 'spawnFailed') return `Check the ${providerLabel} installation, then retry.`
  return 'Retry discovery. If the problem continues, update the CLI.'
}

export function reasoningLabel(effort: string): string {
  if (effort === 'xhigh') return 'Extra high'
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}

export function providerStateClass(status?: ProviderState): string {
  if (status === 'ready') return 'ready'
  if (status === 'authRequired') return 'warning'
  if (status === 'error') return 'error'
  return 'unavailable'
}

export function providerStateLabel(status: ProviderState): string {
  if (status === 'ready') return 'Ready'
  if (status === 'authRequired') return 'Sign-in needed'
  if (status === 'installRequired') return 'Not installed'
  return 'Needs attention'
}

export function effectiveCommand(provider: AiProvider, model: string, reasoning: string | null): string {
  const modelPart = model === 'default' ? '(CLI resolves model)' : model
  if (provider === 'claude_code') return `claude -p · model ${modelPart} · effort ${reasoning ?? '(CLI default)'}`
  if (provider === 'copilot_cli') return `copilot -s --no-ask-user · model ${modelPart}`
  return `codex exec · model ${modelPart} · reasoning ${reasoning ?? '(CLI default)'}`
}

export function defaultValueDescription(
  field: 'model' | 'reasoning',
  overridden: boolean,
  snapshot: ProviderDefaultSnapshot | null,
  uiState: ProviderDiscoveryUiState,
): string {
  const observation = field === 'model' ? snapshot?.model : snapshot?.reasoningEffort
  const label = observation?.value
  const source = originSummary(observation?.origin ?? null)
  const detected = label ? `${label}${source ? ` from ${source}` : ''}` : null
  if (overridden) {
    return detected
      ? `Override active · CLI default is ${detected}.`
      : 'Override active · no CLI default detected.'
  }
  if (uiState === 'checking') return 'Checking the CLI default…'
  if (uiState === 'refreshing') {
    return detected
      ? `Refreshing · previously ${detected}.`
      : 'Refreshing the CLI default…'
  }
  if (snapshot?.state === 'stale' && detected) return `Last detected ${detected} · refresh failed.`
  if (detected) return source ? `CLI default from ${source}.` : 'CLI default detected.'
  if (snapshot?.state === 'providerManaged') return 'The CLI chooses this when generation starts.'
  if (snapshot?.state === 'unavailable') return 'Provider unavailable · CLI-default intent preserved.'
  return 'The CLI chooses this at run time; the current value could not be inspected.'
}

export function discoveryStatusIcon(state: ProviderDiscoveryUiState) {
  if (state === 'checking' || state === 'refreshing') return <Loader2 className="spin" size={17} />
  if (state === 'ready') return <CheckCircle2 size={17} />
  if (state === 'stale') return <Clock3 size={17} />
  return <AlertCircle size={17} />
}

export function discoveryStatusTitle(state: ProviderDiscoveryUiState, snapshotState?: ProviderDiscoveryState): string {
  if (state === 'checking') return 'Checking CLI configuration'
  if (state === 'refreshing') return 'Refreshing CLI configuration'
  if (state === 'stale' || snapshotState === 'stale') return 'Showing the last successful detection'
  if (snapshotState === 'providerManaged') return 'Configuration is provider-managed'
  if (snapshotState === 'unavailable') return 'Provider unavailable'
  if (state === 'error') return 'CLI configuration could not be inspected'
  return 'Configuration detected'
}

export function discoveryStatusBody(
  state: ProviderDiscoveryUiState,
  snapshot: ProviderDefaultSnapshot | null,
): string {
  if (state === 'checking') return 'Your saved selection remains active while QA Scribe checks the local CLI.'
  if (state === 'refreshing') return 'The previous observation stays visible until this refresh finishes.'
  if (snapshot?.state === 'stale') {
    return `${formatCheckedAt(snapshot.checkedAt)}. The CLI will still resolve its live configuration when a run starts.`
  }
  if (snapshot?.state === 'providerManaged') return 'No explicit values were exposed. The CLI will choose them when a run starts.'
  if (snapshot?.state === 'unavailable') return snapshot.error
    ? sanitizedDiscoveryRecovery(snapshot.error.code, 'the CLI')
    : 'Set up this provider, then retry discovery.'
  if (snapshot?.state === 'unresolved') {
    const recovery = snapshot.error
      ? sanitizedDiscoveryRecovery(snapshot.error.code, 'the CLI')
      : 'Retry discovery.'
    return `${recovery} CLI-default execution remains available once the provider is ready.`
  }
  return `Checked ${formatCheckedAt(snapshot?.checkedAt ?? null)}.`
}

export function formatCheckedAt(value: string | null): string {
  if (!value) return 'Not checked yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export function originDetail(origin: ProviderDefaultOrigin | null): string {
  if (!origin) return 'Not reported'
  return origin.displayPath ?? origin.label
}
