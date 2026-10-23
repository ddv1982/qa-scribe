import type { Finding } from '../tauri'
import { richEditorDocumentFromHtml, richEditorDocumentFromStoredBody, richEditorDocumentToHtml, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { parseFindingMetadata, updateFindingMetadata, type FindingSeverity } from './metadata'

type FindingContent = Pick<Finding, 'body' | 'bodyJson' | 'bodyFormat' | 'metadataJson'>
const knownSeverities = new Set(['low', 'medium', 'high', 'critical'])

function severitySection(record: FindingContent) {
  const html = richEditorDocumentToHtml(richEditorDocumentFromStoredBody(record))
  const fragment = new DOMParser().parseFromString(html, 'text/html')
  const heading = Array.from(fragment.body.querySelectorAll('h2,h3')).find(node => node.textContent?.trim().toLowerCase() === 'severity')
  if (!heading) return null
  const nodes: Element[] = []
  for (let node = heading.nextElementSibling; node && !/^H[23]$/.test(node.tagName); node = node.nextElementSibling) nodes.push(node)
  const text = nodes.map(node => node.textContent?.trim() ?? '').join(' ').toLowerCase()
  const recognized = nodes.length === 1 && nodes[0].tagName === 'P'
    && !nodes[0].querySelector('a,img,input,ul,ol') && knownSeverities.has(text)
  return { fragment, heading, nodes, severity: recognized ? text as FindingSeverity : 'unspecified' as const, recognized }
}

export function findingSeverityValue(record: FindingContent): FindingSeverity {
  return severitySection(record)?.severity ?? parseFindingMetadata(record.metadataJson).severity
}

export function prepareFindingForEditing(record: FindingContent) {
  const section = severitySection(record)
  if (!section) return null
  const metadataJson = updateFindingMetadata(record.metadataJson, { severity: section.severity }) ?? '{}'
  if (section.recognized) {
    section.heading.remove()
    section.nodes.forEach(node => node.remove())
  } else section.heading.textContent = 'Severity detail'
  return { ...richEditorDocumentToStoredBody(richEditorDocumentFromHtml(section.fragment.body.innerHTML)), metadataJson }
}
