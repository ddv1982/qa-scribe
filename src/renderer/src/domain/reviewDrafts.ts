import type { Draft, EvidenceLink, Finding as StoredFinding, SessionSnapshot } from '../../../shared/contracts'
import type { ContextRow, Finding, JiraBugDraft, ReviewDraft } from './types'
import { parseStructuredFindingDetails } from './findingDetails'
import { firstLine, formatEntryType } from './formatters'
import { normalizeContextRows } from './generation'

export function normalizeFinding(
  value: StoredFinding,
  evidenceLinks: EvidenceLink[]
): Finding {
  const linkedEvidence = evidenceLinks.filter((link) => link.findingId === value.id)
  const details = parseStructuredFindingDetails(value.metadataJson)

  return {
    id: value.id,
    sessionId: value.sessionId,
    title: value.title,
    summary: details ? details.actual || details.notes || 'No details added yet.' : value.body,
    details,
    severity: details?.severity ?? value.kind,
    priority: details?.priority ?? null,
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
    aiRunId: value.aiRunId,
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
    aiRunId: null,
    title: 'Session Report Draft',
    content: [
      `# ${snapshot.session.title}`,
      '',
      `Context: ${snapshot.session.testTarget || 'Not set'}`,
      `Environment: ${snapshot.session.environment || 'Not set'}`,
      `Build: ${snapshot.session.buildVersion || 'Not set'}`,
      '',
      '## Objective / Notes',
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
      aiRunId: null,
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
    aiRunId: stringFromUnknown(draftRecord.aiRunId) ?? stringFromUnknown(result.aiRunId) ?? null,
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
  const section = findJiraBugDraftsSection(markdown)?.body
  if (section === undefined) return []

  const chunks = jiraDraftMarkdownChunks(section)
  return chunks
    .map((chunk) => {
      const title = cleanMarkdownHeading(chunk.title)
      if (!title || title === 'None recorded.') return null
      const body = chunk.body.trim()
      return {
        id: `jira-${title}`,
        title,
        description: jiraDescriptionFromBody(body, title),
        steps: sectionValue(body, 'Steps to Reproduce'),
        expected: sectionValue(body, 'Expected Result') || sectionValue(body, 'Expected'),
        actual: sectionValue(body, 'Actual Result') || sectionValue(body, 'Actual'),
        evidence: sectionValue(body, 'Evidence')
      }
    })
    .filter((draft): draft is JiraBugDraft => draft !== null)
}

export function jiraBugDraftsForReviewDraft(draft: ReviewDraft, findings: Finding[]): JiraBugDraft[] {
  if (hasJiraBugDraftsSection(draft.content)) return jiraDraftsFromMarkdown(draft.content)
  if (draft.jiraBugDrafts.length > 0) return draft.jiraBugDrafts
  return findings.map(jiraDraftFromFinding)
}

export function hasJiraBugDraftsSection(markdown: string): boolean {
  return findJiraBugDraftsSection(markdown) !== null
}

export function reportContentFromDraftContent(markdown: string): string {
  const section = findJiraBugDraftsSection(markdown)
  if (section) return markdown.slice(0, section.startIndex).trimEnd()
  return markdown
}

export function sectionValue(markdown: string, label: string): string {
  const targetLabel = normalizeJiraFieldLabel(label)
  const valueLines: string[] = []
  let collecting = false

  for (const line of markdown.split('\n')) {
    const field = boldFieldLine(line)
    if (field) {
      if (collecting) break
      if (normalizeJiraFieldLabel(field.label) === targetLabel) {
        collecting = true
        if (field.value) valueLines.push(field.value)
      }
      continue
    }

    if (collecting) valueLines.push(line)
  }

  return valueLines.join('\n').trim()
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
  const details = finding.details
  return {
    id: `jira-${finding.id}`,
    title: finding.title,
    description: details?.notes || finding.summary,
    steps:
      details && details.steps.length > 0
        ? details.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
        : '1. Review linked evidence and fill exact reproduction steps.',
    expected: details?.expected || 'Expected result not drafted yet.',
    actual: details?.actual || 'Actual result not drafted yet.',
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

type JiraMarkdownSection = {
  startIndex: number
  body: string
}

type JiraMarkdownChunk = {
  title: string
  body: string
}

function findJiraBugDraftsSection(markdown: string): JiraMarkdownSection | null {
  const headingPattern = /^[ \t]{0,3}(#{1,6})[ \t]+Jira Bug Drafts[ \t]*#*[ \t]*$/gim
  const match = headingPattern.exec(markdown)
  if (!match) return null

  const headingLevel = match[1].length
  const sectionStart = match.index + match[0].length
  const rest = markdown.slice(sectionStart)
  const nextHeadingPattern = /^[ \t]{0,3}(#{1,6})[ \t]+\S.*$/gm
  let sectionEnd = markdown.length
  let nextHeading: RegExpExecArray | null

  while ((nextHeading = nextHeadingPattern.exec(rest)) !== null) {
    if (nextHeading[1].length <= headingLevel) {
      sectionEnd = sectionStart + nextHeading.index
      break
    }
  }

  return {
    startIndex: match.index,
    body: markdown.slice(sectionStart, sectionEnd).trim()
  }
}

function jiraDraftMarkdownChunks(section: string): JiraMarkdownChunk[] {
  const headingPattern = /^[ \t]{0,3}###[ \t]+(.+?)[ \t]*#*[ \t]*$/gm
  const headings: Array<{ title: string; headingStart: number; bodyStart: number }> = []
  let heading: RegExpExecArray | null

  while ((heading = headingPattern.exec(section)) !== null) {
    headings.push({
      title: heading[1],
      headingStart: heading.index,
      bodyStart: heading.index + heading[0].length
    })
  }

  return headings.map((item, index) => ({
    title: item.title,
    body: section.slice(item.bodyStart, headings[index + 1]?.headingStart ?? section.length)
  }))
}

function cleanMarkdownHeading(value: string): string {
  return value.replace(/[ \t]+#+[ \t]*$/, '').trim()
}

function jiraDescriptionFromBody(body: string, title: string): string {
  const descriptionLines: string[] = []
  for (const line of body.split('\n')) {
    if (boldFieldLine(line)) break
    descriptionLines.push(line)
  }

  return descriptionLines.join('\n').trim() || title
}

function boldFieldLine(line: string): { label: string; value: string } | null {
  const match = line.match(/^\s*\*\*([^*]+?)\*\*\s*:?\s*(.*)$/)
  if (!match) return null
  return {
    label: match[1].replace(/:$/, '').trim(),
    value: match[2].replace(/^:\s*/, '').trim()
  }
}

function normalizeJiraFieldLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}
