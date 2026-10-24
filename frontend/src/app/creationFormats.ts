import starters from '../../../shared/creation-starters.json'
import { richEditorDocumentFromHtml, type RichEditorDocument } from '../editor/editorDocument'
import { testwareOutputFormatOptions } from '../testware/generationPreferences'
import type { CreationKind, TestwareOutputFormat } from '../tauri'

export type CreationFormat =
  | { kind: 'testware'; outputFormat: TestwareOutputFormat }
  | { kind: 'finding'; template: 'structured' | 'blank' }

export const creationFormatMetadataKey = 'manualCreationFormat'

export const findingTemplateOptions = [
  { id: 'structured', label: 'Structured finding', description: 'The same sections used in generated findings.' },
  { id: 'blank', label: 'Blank', description: 'Start with an empty body.' },
] as const

export function defaultCreationFormat(kind: CreationKind): CreationFormat {
  return kind === 'testware' ? { kind, outputFormat: 'qa_cases' } : { kind, template: 'structured' }
}

export function creationFormatOptions(kind: CreationKind) {
  return kind === 'testware' ? testwareOutputFormatOptions : findingTemplateOptions
}

export function creationFormatId(format: CreationFormat): string {
  return format.kind === 'testware' ? format.outputFormat : format.template
}

export function creationFormatForId(kind: CreationKind, id: string): CreationFormat | null {
  if (kind === 'testware') {
    const option = testwareOutputFormatOptions.find(option => option.id === id)
    return option ? { kind, outputFormat: option.id } : null
  }
  const option = findingTemplateOptions.find(option => option.id === id)
  return option ? { kind, template: option.id } : null
}

export function creationStarter(format: CreationFormat): RichEditorDocument {
  const html = format.kind === 'testware' ? starters.testwareFormats[format.outputFormat].html
    : format.template === 'blank' ? '' : starters.finding.map(section => `<h3>${section}</h3><p></p>`).join('')
  return richEditorDocumentFromHtml(html)
}

export function creationFormatHint(format: CreationFormat): string {
  return format.kind === 'testware' ? starters.testwareFormats[format.outputFormat].hint
    : format.template === 'blank' ? 'Write your finding in your own structure.' : 'Describe the environment, reproduction steps, expected and actual results, evidence, and impact.'
}

export function withCreationFormatMetadata(current: string | null, format: CreationFormat): string {
  return JSON.stringify({ ...creationMetadata(current), [creationFormatMetadataKey]: { version: 1, format } })
}

export function hasAuthoredCreationMetadata(current: string | null): boolean {
  if (!current) return false
  const metadata = creationMetadata(current)
  if (!metadata) return true
  return Object.keys(metadata).some(key => key !== creationFormatMetadataKey)
}

function creationMetadata(current: string | null): Record<string, unknown> | null {
  if (!current) return {}
  try {
    const value: unknown = JSON.parse(current)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}
