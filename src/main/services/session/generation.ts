import { z } from 'zod'
import type { GenerationContextReview } from '../../../shared/contracts'
import { labelEntryType } from './utils'

export const promptVersion = 'session-report-v1'

export const generatedReportSchema = z.object({
  whatWasTested: z.string(),
  scenariosCovered: z.array(z.string()),
  checks: z.array(
    z.object({
      title: z.string(),
      status: z.enum(['passed', 'failed', 'blocked', 'unknown']),
      notes: z.string().optional()
    })
  ),
  findings: z.array(z.string()),
  bugs: z.array(
    z.object({
      title: z.string(),
      stepsToReproduce: z.array(z.string()),
      expectedResult: z.string(),
      actualResult: z.string(),
      evidence: z.array(z.string()).optional()
    })
  ),
  openQuestions: z.array(z.string()),
  followUpActions: z.array(z.string()),
  jiraBugDrafts: z.array(
    z.object({
      summary: z.string(),
      description: z.string(),
      stepsToReproduce: z.array(z.string()),
      expectedResult: z.string(),
      actualResult: z.string(),
      evidence: z.array(z.string()).optional()
    })
  )
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
    whatWasTested: { type: 'string' },
    scenariosCovered: { type: 'array', items: { type: 'string' } },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'status'],
        properties: {
          title: { type: 'string' },
          status: { type: 'string', enum: ['passed', 'failed', 'blocked', 'unknown'] },
          notes: { type: 'string' }
        }
      }
    },
    findings: { type: 'array', items: { type: 'string' } },
    bugs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'stepsToReproduce', 'expectedResult', 'actualResult'],
        properties: {
          title: { type: 'string' },
          stepsToReproduce: { type: 'array', items: { type: 'string' } },
          expectedResult: { type: 'string' },
          actualResult: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
    followUpActions: { type: 'array', items: { type: 'string' } },
    jiraBugDrafts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'description', 'stepsToReproduce', 'expectedResult', 'actualResult'],
        properties: {
          summary: { type: 'string' },
          description: { type: 'string' },
          stepsToReproduce: { type: 'array', items: { type: 'string' } },
          expectedResult: { type: 'string' },
          actualResult: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } }
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
    'Return concise but useful structured output that matches the requested schema.',
    'Screenshots and files are represented by metadata only; do not assume image contents.',
    '',
    'Session Metadata:',
    `- ID: ${review.session.id}`,
    `- Title: ${review.session.title}`,
    `- Test Target: ${review.session.testTarget ?? 'Not set'}`,
    `- Test Objective: ${review.session.charter ?? 'Not set'}`,
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
    report.checks
      .map((check) => `- [${check.status}] ${check.title}${check.notes ? `: ${check.notes}` : ''}`)
      .join('\n') || '- None recorded.',
    '',
    '## Findings',
    '',
    renderList(report.findings),
    '',
    '## Bugs',
    '',
    report.bugs
      .map(
        (bug) =>
          [
            `### ${bug.title}`,
            '',
            '**Steps to Reproduce**',
            renderOrderedList(bug.stepsToReproduce),
            '',
            `**Expected:** ${bug.expectedResult}`,
            '',
            `**Actual:** ${bug.actualResult}`,
            '',
            '**Evidence**',
            renderList(bug.evidence ?? [])
          ].join('\n')
      )
      .join('\n\n') || 'None recorded.',
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

function renderOrderedList(values: string[]): string {
  return values.length > 0 ? values.map((value, index) => `${index + 1}. ${value}`).join('\n') : '1. None recorded.'
}
