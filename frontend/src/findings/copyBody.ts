import { prepareFindingForEditing } from './severity'
import { parseFindingMetadata } from './metadata'

export function findingCopyBody(body: string, metadataJson: string | null): string {
  const normalized = prepareFindingForEditing({ body, bodyJson: null, bodyFormat: 'html', metadataJson })
  if (normalized) { body = normalized.body; metadataJson = normalized.metadataJson }
  const severity = parseFindingMetadata(metadataJson).severity
  if (severity === 'unspecified') return body
  const label = severity[0].toUpperCase() + severity.slice(1)
  return `<p><strong>Severity:</strong> ${label}</p>${body}`
}
