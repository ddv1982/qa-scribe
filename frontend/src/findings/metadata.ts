export type FindingSeverity = 'unspecified' | 'low' | 'medium' | 'high' | 'critical'
export type FindingStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export type FindingMetadata = {
  severity: FindingSeverity
  status: FindingStatus
  component: string
  reference: string
}

const severities = new Set<FindingSeverity>(['unspecified', 'low', 'medium', 'high', 'critical'])
const statuses = new Set<FindingStatus>(['open', 'in_progress', 'resolved', 'closed'])

export function parseFindingMetadata(value: string | null): FindingMetadata {
  const parsed = parseObject(value)
  const severity = typeof parsed.severity === 'string' && severities.has(parsed.severity as FindingSeverity)
    ? parsed.severity as FindingSeverity
    : 'unspecified'
  const status = typeof parsed.status === 'string' && statuses.has(parsed.status as FindingStatus)
    ? parsed.status as FindingStatus
    : 'open'
  return {
    severity,
    status,
    component: typeof parsed.component === 'string' ? parsed.component : '',
    reference: typeof parsed.reference === 'string' ? parsed.reference : '',
  }
}

export function updateFindingMetadata(
  current: string | null,
  patch: Partial<FindingMetadata>,
): string | null {
  const source = parseObject(current)
  const next: Record<string, string> = { ...source, ...parseFindingMetadata(current), ...patch }
  if (next.severity === 'unspecified') delete next.severity
  if (next.status === 'open') delete next.status
  if (!next.component.trim()) delete next.component
  if (!next.reference.trim()) delete next.reference
  return Object.keys(next).length > 0 ? JSON.stringify(next) : null
}

export function findingSeverityLabel(value: FindingSeverity): string {
  if (value === 'unspecified') return 'Severity not set'
  return `${value.charAt(0).toUpperCase()}${value.slice(1)} severity`
}

export function findingStatusLabel(value: FindingStatus): string {
  if (value === 'in_progress') return 'In progress'
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function parseObject(value: string | null): Record<string, string> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, string>
  } catch {
    // Older or externally edited invalid metadata should not make the Finding
    // editor unusable; saving a tester-facing field replaces it with valid JSON.
  }
  return {}
}
