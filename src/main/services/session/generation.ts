import { z } from 'zod'
import type { GenerationContextReview } from '../../../shared/contracts'
import { labelEntryType } from './utils'

export const promptVersion = 'session-report-v1'

const limits = {
  whatWasTestedLength: 280,
  scenarioCount: 5,
  scenarioLength: 120,
  checkCount: 8,
  findingCount: 5,
  bugCount: 3,
  jiraBugDraftCount: 3,
  questionCount: 3,
  actionCount: 3,
  titleLength: 120,
  shortFieldLength: 180,
  detailFieldLength: 320,
  evidenceCount: 3,
  evidenceLength: 140,
  stepsCount: 6,
  stepLength: 180
}

const evidenceSchema = z.array(z.string().max(limits.evidenceLength)).max(limits.evidenceCount)

export const generatedReportSchema = z.object({
  whatWasTested: z.string().max(limits.whatWasTestedLength),
  scenariosCovered: z.array(z.string().max(limits.scenarioLength)).max(limits.scenarioCount),
  checks: z.array(
    z.object({
      title: z.string().max(limits.titleLength),
      status: z.enum(['passed', 'failed', 'blocked', 'unknown']),
      expectedResult: z.string().max(limits.detailFieldLength).nullable().optional(),
      actualResult: z.string().max(limits.detailFieldLength).nullable().optional(),
      evidence: evidenceSchema.nullable().optional(),
      notes: z.string().max(limits.shortFieldLength).nullable().optional()
    })
  ).max(limits.checkCount),
  findings: z.array(
    z.object({
      title: z.string().max(limits.titleLength),
      type: z.enum(['bug', 'risk', 'question', 'follow_up', 'note']),
      summary: z.string().max(limits.detailFieldLength),
      severity: z.string().max(limits.shortFieldLength).nullable().optional(),
      priority: z.string().max(limits.shortFieldLength).nullable().optional(),
      expectedResult: z.string().max(limits.detailFieldLength).nullable().optional(),
      actualResult: z.string().max(limits.detailFieldLength).nullable().optional(),
      evidence: evidenceSchema.nullable().optional(),
      followUp: z.string().max(limits.detailFieldLength).nullable().optional()
    })
  ).max(limits.findingCount),
  bugs: z.array(
    z.object({
      title: z.string().max(limits.titleLength),
      stepsToReproduce: z.array(z.string().max(limits.stepLength)).max(limits.stepsCount),
      expectedResult: z.string().max(limits.detailFieldLength),
      actualResult: z.string().max(limits.detailFieldLength),
      evidence: evidenceSchema.nullable().optional()
    })
  ).max(limits.bugCount),
  openQuestions: z.array(z.string().max(limits.detailFieldLength)).max(limits.questionCount),
  followUpActions: z.array(z.string().max(limits.detailFieldLength)).max(limits.actionCount),
  jiraBugDrafts: z.array(
    z.object({
      summary: z.string().max(limits.titleLength),
      description: z.string().max(limits.detailFieldLength),
      stepsToReproduce: z.array(z.string().max(limits.stepLength)).max(limits.stepsCount),
      expectedResult: z.string().max(limits.detailFieldLength),
      actualResult: z.string().max(limits.detailFieldLength),
      evidence: evidenceSchema.nullable().optional()
    })
  ).max(limits.jiraBugDraftCount)
})

export const generatedReportJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'whatWasTested',
    'scenariosCovered',
    'checks',
    'findings',
    'bugs',
    'openQuestions',
    'followUpActions',
    'jiraBugDrafts'
  ],
  properties: {
    whatWasTested: { type: 'string', maxLength: limits.whatWasTestedLength },
    scenariosCovered: {
      type: 'array',
      maxItems: limits.scenarioCount,
      items: { type: 'string', maxLength: limits.scenarioLength }
    },
    checks: {
      type: 'array',
      maxItems: limits.checkCount,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'status', 'expectedResult', 'actualResult', 'evidence', 'notes'],
        properties: {
          title: { type: 'string', maxLength: limits.titleLength },
          status: { type: 'string', enum: ['passed', 'failed', 'blocked', 'unknown'] },
          expectedResult: { type: ['string', 'null'], maxLength: limits.detailFieldLength },
          actualResult: { type: ['string', 'null'], maxLength: limits.detailFieldLength },
          evidence: {
            type: ['array', 'null'],
            maxItems: limits.evidenceCount,
            items: { type: 'string', maxLength: limits.evidenceLength }
          },
          notes: { type: ['string', 'null'], maxLength: limits.shortFieldLength }
        }
      }
    },
    findings: {
      type: 'array',
      maxItems: limits.findingCount,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'type',
          'summary',
          'severity',
          'priority',
          'expectedResult',
          'actualResult',
          'evidence',
          'followUp'
        ],
        properties: {
          title: { type: 'string', maxLength: limits.titleLength },
          type: { type: 'string', enum: ['bug', 'risk', 'question', 'follow_up', 'note'] },
          summary: { type: 'string', maxLength: limits.detailFieldLength },
          severity: { type: ['string', 'null'], maxLength: limits.shortFieldLength },
          priority: { type: ['string', 'null'], maxLength: limits.shortFieldLength },
          expectedResult: { type: ['string', 'null'], maxLength: limits.detailFieldLength },
          actualResult: { type: ['string', 'null'], maxLength: limits.detailFieldLength },
          evidence: {
            type: ['array', 'null'],
            maxItems: limits.evidenceCount,
            items: { type: 'string', maxLength: limits.evidenceLength }
          },
          followUp: { type: ['string', 'null'], maxLength: limits.detailFieldLength }
        }
      }
    },
    bugs: {
      type: 'array',
      maxItems: limits.bugCount,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'stepsToReproduce', 'expectedResult', 'actualResult', 'evidence'],
        properties: {
          title: { type: 'string', maxLength: limits.titleLength },
          stepsToReproduce: {
            type: 'array',
            maxItems: limits.stepsCount,
            items: { type: 'string', maxLength: limits.stepLength }
          },
          expectedResult: { type: 'string', maxLength: limits.detailFieldLength },
          actualResult: { type: 'string', maxLength: limits.detailFieldLength },
          evidence: {
            type: ['array', 'null'],
            maxItems: limits.evidenceCount,
            items: { type: 'string', maxLength: limits.evidenceLength }
          }
        }
      }
    },
    openQuestions: {
      type: 'array',
      maxItems: limits.questionCount,
      items: { type: 'string', maxLength: limits.detailFieldLength }
    },
    followUpActions: {
      type: 'array',
      maxItems: limits.actionCount,
      items: { type: 'string', maxLength: limits.detailFieldLength }
    },
    jiraBugDrafts: {
      type: 'array',
      maxItems: limits.jiraBugDraftCount,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'description', 'stepsToReproduce', 'expectedResult', 'actualResult', 'evidence'],
        properties: {
          summary: { type: 'string', maxLength: limits.titleLength },
          description: { type: 'string', maxLength: limits.detailFieldLength },
          stepsToReproduce: {
            type: 'array',
            maxItems: limits.stepsCount,
            items: { type: 'string', maxLength: limits.stepLength }
          },
          expectedResult: { type: 'string', maxLength: limits.detailFieldLength },
          actualResult: { type: 'string', maxLength: limits.detailFieldLength },
          evidence: {
            type: ['array', 'null'],
            maxItems: limits.evidenceCount,
            items: { type: 'string', maxLength: limits.evidenceLength }
          }
        }
      }
    }
  }
}

export type GeneratedReport = z.infer<typeof generatedReportSchema>

export function buildGenerationPrompt(review: GenerationContextReview): string {
  const includedEntries = review.entries.filter((item) => item.included)
  const lines = [
    'You are helping a tester turn a local testing session into structured testware.',
    'Use only the information in this context. Do not invent unsupported facts.',
    'Return concise, scannable structured output that matches the requested schema.',
    'Screenshots and files are represented by metadata only; do not assume image contents.',
    'Preserve the difference between a Check and a Finding: a Check records expected versus actual outcome and pass/fail/blocked/unknown status; a Finding is only for a bug, risk, question, follow-up, or note that needs triage or action.',
    'If the actual result matches the expected result, make it a passed Check. If it differs, make it a failed Check and create a Finding only when the context supports a triage-worthy issue.',
    'Brevity rules: whatWasTested is one sentence; checks are one-line facts; findings are only triage-worthy; openQuestions and followUpActions are only actionable gaps.',
    `Caps: max ${limits.scenarioCount} scenarios, ${limits.checkCount} checks, ${limits.findingCount} findings, ${limits.questionCount} open questions, ${limits.actionCount} follow-up actions, and ${limits.jiraBugDraftCount} Jira bug drafts.`,
    'Use bugs and jiraBugDrafts only for real bugs. Keep both lists aligned and avoid duplicating narrative detail across fields.',
    '',
    'Session Metadata:',
    `- ID: ${review.session.id}`,
    `- Title: ${review.session.title}`,
    `- Context: ${review.session.testTarget ?? 'Not set'}`,
    `- Objective/Notes: ${review.session.charter ?? 'Not set'}`,
    `- Environment: ${review.session.environment ?? 'Not set'}`,
    `- Build/Version: ${review.session.buildVersion ?? 'Not set'}`,
    `- Related Reference: ${review.session.relatedReference ?? 'Not set'}`,
    '',
    'Included Timeline Entries:'
  ]

  if (includedEntries.length === 0) {
    lines.push('- No timeline entries were included.')
  }

  for (const item of includedEntries) {
    lines.push(
      `- [${labelEntryType(item.entry.type)}] ${item.entry.title || 'Untitled'} at ${item.entry.createdAt}`,
      item.entry.body
    )

    for (const attachment of item.attachments) {
      lines.push(
        `  Attachment: ${attachment.filename}; type=${attachment.mimeType ?? 'unknown'}; bytes=${attachment.sizeBytes}; sha256=${attachment.sha256}`
      )
    }
  }

  lines.push('', 'Session-level Attachments:')

  const includedAttachments = review.attachments.filter((item) => item.included)

  if (includedAttachments.length === 0) {
    lines.push('- No session-level attachments were included.')
  }

  for (const { attachment } of includedAttachments) {
    lines.push(
      `- ${attachment.filename}; type=${attachment.mimeType ?? 'unknown'}; bytes=${attachment.sizeBytes}; sha256=${attachment.sha256}`
    )
  }

  lines.push('', 'Manual Findings:')

  if (review.findings.length === 0) {
    lines.push('- No manual Findings were created.')
  }

  for (const item of review.findings) {
    lines.push(`- [${item.finding.kind}] ${item.finding.title}`, item.finding.body)
    if (item.evidenceLinks.length > 0) {
      lines.push(`  Evidence links: ${item.evidenceLinks.length}`)
    }
  }

  return lines.join('\n')
}

export function renderGeneratedReport(report: GeneratedReport): string {
  return [
    '# Session Report',
    '',
    '## What Was Tested',
    '',
    report.whatWasTested,
    '',
    '## Scenarios Covered',
    '',
    renderList(report.scenariosCovered),
    '',
    '## Checks',
    '',
    renderChecks(report.checks),
    '',
    '## Findings',
    '',
    renderFindings(report.findings),
    '',
    '## Open Questions',
    '',
    renderList(report.openQuestions),
    '',
    '## Follow-up Actions',
    '',
    renderList(report.followUpActions),
    '',
    '## Jira Bug Drafts',
    '',
    report.jiraBugDrafts
      .map(
        (bug) =>
          [
            `### ${bug.summary}`,
            '',
            bug.description,
            '',
            '**Steps to Reproduce**',
            renderOrderedList(bug.stepsToReproduce),
            '',
            `**Expected Result:** ${bug.expectedResult}`,
            '',
            `**Actual Result:** ${bug.actualResult}`,
            '',
            '**Evidence**',
            renderList(bug.evidence ?? [])
          ].join('\n')
      )
      .join('\n\n') || 'None recorded.'
  ].join('\n')
}

function renderList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- None recorded.'
}

function renderChecks(checks: GeneratedReport['checks']): string {
  if (checks.length === 0) return '- None recorded.'
  return checks
    .map((check) =>
      [
        `- [${check.status}] ${check.title}`,
        inlinePart('Expected', check.expectedResult),
        inlinePart('Actual', check.actualResult),
        inlinePart('Notes', check.notes),
        inlineListPart('Evidence', check.evidence)
      ]
        .filter(Boolean)
        .join(' ')
    )
    .join('\n')
}

function renderFindings(findings: GeneratedReport['findings']): string {
  if (findings.length === 0) return '- None recorded.'
  return findings
    .map((finding) =>
      [
        `- [${finding.type}] ${finding.title}: ${finding.summary}`,
        inlinePart('Severity', finding.severity),
        inlinePart('Priority', finding.priority),
        inlinePart('Expected', finding.expectedResult),
        inlinePart('Actual', finding.actualResult),
        inlineListPart('Evidence', finding.evidence),
        inlinePart('Follow-up', finding.followUp)
      ]
        .filter(Boolean)
        .join(' ')
    )
    .join('\n')
}

function renderOrderedList(values: string[]): string {
  return values.length > 0 ? values.map((value, index) => `${index + 1}. ${value}`).join('\n') : '1. None recorded.'
}

function inlinePart(label: string, value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? `**${label}:** ${trimmed};` : ''
}

function inlineListPart(label: string, values: string[] | null | undefined): string {
  if (!values || values.length === 0) return ''
  return `**${label}:** ${values.join('; ')};`
}
