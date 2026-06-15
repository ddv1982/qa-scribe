import type { Draft, EvidenceLink, Finding as StoredFinding, SessionSnapshot } from '../../../shared/contracts'
import type { ContextRow, Finding, JiraBugDraft, ReviewDraft } from './types'
import { firstLine, formatEntryType } from './formatters'
import { normalizeContextRows } from './generation'

export function normalizeFinding(
  value: StoredFinding,
  evidenceLinks: EvidenceLink[]
): Finding {
  const linkedEvidence = evidenceLinks.filter((link) => link.findingId === value.id)

  return {
    id: value.id,
    sessionId: value.sessionId,
    title: value.title,
    summary: value.body,
    severity: value.kind,
    status: 'draft',
    evidenceEntryIds: linkedEvidence.map((link) => link.entryId).filter((entryId): entryId is string => entryId !== null),
    evidenceAttachmentIds: linkedEvidence
      .map((link) => link.attachmentId)
      .filter((attachmentId): attachmentId is string => attachmentId !== null),
    createdAt: value.createdAt
  }
}

export function normalizeDraft(value: Draft | undefined): ReviewDraft | null {
  if (!value) return null
  return {
    id: value.id,
    sessionId: value.sessionId,
    title: value.title,
    content: value.body,
    jiraBugDrafts: jiraDraftsFromMarkdown(value.body),
    updatedAt: value.updatedAt
  }
}

export function createLocalReviewDraft(snapshot: SessionSnapshot, findings: Finding[], rows: ContextRow[]): ReviewDraft {
  const includedRows = rows.length > 0 ? rows : normalizeContextRows(null, snapshot).filter((row) => row.included)
  return {
    id: `local-draft-${snapshot.session.id}`,
    sessionId: snapshot.session.id,
    title: 'Session Report Draft',
    content: [
      `# ${snapshot.session.title}`,
      '',
      `Test Target: ${snapshot.session.testTarget || 'Not set'}`,
      `Environment: ${snapshot.session.environment || 'Not set'}`,
      `Build: ${snapshot.session.buildVersion || 'Not set'}`,
      '',
      '## Test Objective',
      snapshot.session.charter || 'Not set',
      '',
      '## What Was Tested',
      includedRows.map((row) => `- ${row.entry.title || firstLine(row.entry.body) || formatEntryType(row.entry.type)}`).join('\n') ||
        '- Not drafted yet',
      '',
      '## Findings',
      findings.map((finding) => `- ${finding.title}: ${finding.summary}`).join('\n') || '- No Findings recorded.',
      '',
      '## Open Questions',
      '- Review and edit before sharing.',
      '',
      '## Follow-up Actions',
      '- Review evidence links and Jira bug drafts.'
    ].join('\n'),
    jiraBugDrafts: findings.map(jiraDraftFromFinding),
    updatedAt: new Date().toISOString()
  }
}

export function draftFromGenerationResult(result: unknown, snapshot: SessionSnapshot, findings: Finding[]): ReviewDraft {
  if (typeof result === 'string') {
    return {
      ...createLocalReviewDraft(snapshot, findings, []),
      content: result,
      updatedAt: new Date().toISOString()
    }
  }

  if (!isRecord(result)) return createLocalReviewDraft(snapshot, findings, [])

  const draftRecord = isRecord(result.draft) ? result.draft : result
  const content =
    stringFromUnknown(draftRecord.content) ??
    stringFromUnknown(draftRecord.body) ??
    stringFromUnknown(draftRecord.markdown) ??
    stringFromUnknown(draftRecord.sessionReportDraft) ??
    createLocalReviewDraft(snapshot, findings, []).content

  return {
    id: stringFromUnknown(draftRecord.id) ?? `local-draft-${snapshot.session.id}`,
    sessionId: snapshot.session.id,
    title: stringFromUnknown(draftRecord.title) ?? 'Session Report Draft',
    content,
    jiraBugDrafts: jiraDraftsFromUnknown(draftRecord.jiraBugDrafts ?? result.jiraBugDrafts, findings),
    updatedAt: stringFromUnknown(draftRecord.updatedAt) ?? new Date().toISOString()
  }
}

export function jiraDraftsFromUnknown(value: unknown, findings: Finding[]): JiraBugDraft[] {
  if (!Array.isArray(value)) return findings.map(jiraDraftFromFinding)
  const drafts = value.map(jiraDraftFromUnknown).filter((draft): draft is JiraBugDraft => draft !== null)
  return drafts.length > 0 ? drafts : findings.map(jiraDraftFromFinding)
}

export function jiraDraftsFromMarkdown(markdown: string): JiraBugDraft[] {
  const section = markdown.split('## Jira Bug Drafts')[1]
  if (!section) return []

  return section
    .split('\n### ')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [rawTitle, ...bodyLines] = chunk.split('\n')
      const title = rawTitle.replace(/^###\s*/, '').trim()
      if (!title || title === 'None recorded.') return null
      const body = bodyLines.join('\n').trim()
      return {
        id: `jira-${title}`,
        title,
        description: body || title,
        steps: sectionValue(body, 'Steps to Reproduce'),
        expected: sectionValue(body, 'Expected Result') || sectionValue(body, 'Expected'),
        actual: sectionValue(body, 'Actual Result') || sectionValue(body, 'Actual'),
        evidence: sectionValue(body, 'Evidence')
      }
    })
    .filter((draft): draft is JiraBugDraft => draft !== null)
}

export function sectionValue(markdown: string, label: string): string {
  const marker = `**${label}`
  const start = markdown.indexOf(marker)
  if (start < 0) return ''
  const after = markdown.slice(start).split('\n').slice(1).join('\n').trim()
  return after.split('\n**')[0]?.trim() ?? ''
}

export function jiraDraftFromUnknown(value: unknown): JiraBugDraft | null {
  if (!isRecord(value)) return null
  const title = stringFromUnknown(value.title) ?? stringFromUnknown(value.summary)
  if (!title) return null
  return {
    id: stringFromUnknown(value.id) ?? `jira-${title}`,
    title,
    description: stringFromUnknown(value.description) ?? stringFromUnknown(value.body) ?? '',
    steps: stringFromUnknown(value.steps) ?? stringFromUnknown(value.reproductionSteps) ?? '',
    expected: stringFromUnknown(value.expected) ?? stringFromUnknown(value.expectedResult) ?? '',
    actual: stringFromUnknown(value.actual) ?? stringFromUnknown(value.actualResult) ?? '',
    evidence: stringFromUnknown(value.evidence) ?? ''
  }
}

export function jiraDraftFromFinding(finding: Finding): JiraBugDraft {
  return {
    id: `jira-${finding.id}`,
    title: finding.title,
    description: finding.summary,
    steps: '1. Review linked evidence and fill exact reproduction steps.',
    expected: 'Expected result not drafted yet.',
    actual: finding.summary,
    evidence: [
      finding.evidenceEntryIds.length > 0 ? `Entries: ${finding.evidenceEntryIds.join(', ')}` : '',
      finding.evidenceAttachmentIds.length > 0 ? `Attachments: ${finding.evidenceAttachmentIds.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
}

export function formatJiraDraft(draft: JiraBugDraft): string {
  return [
    `Title: ${draft.title}`,
    '',
    `Description:\n${draft.description}`,
    '',
    `Steps to Reproduce:\n${draft.steps}`,
    '',
    `Expected:\n${draft.expected}`,
    '',
    `Actual:\n${draft.actual}`,
    '',
    `Evidence:\n${draft.evidence}`
  ].join('\n')
}

export function stringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
