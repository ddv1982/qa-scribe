import type { Session } from '../../../shared/contracts'
import type { StructuredFindingDetails, StructuredFindingDraft } from './types'

export const structuredFindingMetadataSchema = 'qa-scribe.structured-finding.v1'

export function createEmptyStructuredFindingDraft(): StructuredFindingDraft {
  return {
    title: '',
    actual: '',
    expected: '',
    steps: '',
    severity: 'untriaged',
    priority: 'medium',
    environment: '',
    component: '',
    notes: '',
    linkSelectedEntry: true
  }
}

export function createStructuredFindingDetails(
  draft: StructuredFindingDraft,
  session: Session
): StructuredFindingDetails {
  return {
    schema: structuredFindingMetadataSchema,
    actual: draft.actual.trim(),
    expected: draft.expected.trim(),
    steps: splitSteps(draft.steps),
    severity: draft.severity.trim() || 'untriaged',
    priority: draft.priority.trim() || 'medium',
    environment: draft.environment.trim() || [session.environment, session.buildVersion].filter(Boolean).join(' / '),
    component: draft.component.trim(),
    notes: draft.notes.trim()
  }
}

export function renderStructuredFindingBody(details: StructuredFindingDetails): string {
  const lines = [
    ...renderTextSection('Actual Result', details.actual),
    ...renderTextSection('Expected Result', details.expected),
    ...renderStepsSection(details.steps),
    details.severity && details.severity !== 'untriaged' ? `**Severity:** ${details.severity}` : '',
    details.priority && details.priority !== 'medium' ? `**Priority:** ${details.priority}` : '',
    details.component ? `**Component:** ${details.component}` : '',
    details.environment ? `**Environment:** ${details.environment}` : '',
    ...renderTextSection('Notes', details.notes)
  ].filter(Boolean)

  return lines.length > 0 ? lines.join('\n\n') : 'No additional finding details yet.'
}

export function serializeStructuredFindingDetails(details: StructuredFindingDetails): string {
  return JSON.stringify(details)
}

export function parseStructuredFindingDetails(metadataJson: string | null | undefined): StructuredFindingDetails | null {
  if (!metadataJson) return null
  try {
    const value = JSON.parse(metadataJson) as Partial<StructuredFindingDetails>
    if (value.schema !== structuredFindingMetadataSchema) return null
    return {
      schema: structuredFindingMetadataSchema,
      actual: stringOrEmpty(value.actual),
      expected: stringOrEmpty(value.expected),
      steps: Array.isArray(value.steps) ? value.steps.filter((step): step is string => typeof step === 'string') : [],
      severity: stringOrEmpty(value.severity) || 'untriaged',
      priority: stringOrEmpty(value.priority) || 'medium',
      environment: stringOrEmpty(value.environment),
      component: stringOrEmpty(value.component),
      notes: stringOrEmpty(value.notes)
    }
  } catch {
    return null
  }
}

function splitSteps(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

function renderSteps(steps: string[]): string {
  return steps.length > 0 ? steps.map((step, index) => `${index + 1}. ${step}`).join('\n') : '1. Not specified.'
}

function renderTextSection(title: string, value: string): string[] {
  return value ? [`**${title}**`, value] : []
}

function renderStepsSection(steps: string[]): string[] {
  return steps.length > 0 ? ['**Steps to Reproduce**', renderSteps(steps)] : []
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
