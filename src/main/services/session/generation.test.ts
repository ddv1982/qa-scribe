import { describe, expect, it } from 'vitest'
import {
  buildGenerationPrompt,
  generatedReportJsonSchema,
  generatedReportSchema,
  renderGeneratedReport,
  type GeneratedReport
} from './generation'
import type { GenerationContextReview } from '../../../shared/contracts'

describe('generation schema', () => {
  it('uses required nullable fields for OpenAI strict structured outputs', () => {
    const checks = generatedReportJsonSchema.properties.checks.items
    const findings = generatedReportJsonSchema.properties.findings.items
    const bugs = generatedReportJsonSchema.properties.bugs.items
    const jiraBugDrafts = generatedReportJsonSchema.properties.jiraBugDrafts.items

    expect(checks.required).toEqual(['title', 'status', 'expectedResult', 'actualResult', 'evidence', 'notes'])
    expect(checks.properties.expectedResult).toEqual({ type: ['string', 'null'], maxLength: 320 })
    expect(checks.properties.actualResult).toEqual({ type: ['string', 'null'], maxLength: 320 })
    expect(generatedReportJsonSchema.properties.scenariosCovered.maxItems).toBe(5)
    expect(generatedReportJsonSchema.properties.checks.maxItems).toBe(8)
    expect(generatedReportJsonSchema.properties.findings.maxItems).toBe(5)
    expect(generatedReportJsonSchema.properties.openQuestions.maxItems).toBe(3)
    expect(generatedReportJsonSchema.properties.followUpActions.maxItems).toBe(3)
    expect(checks.properties.evidence).toEqual({
      type: ['array', 'null'],
      maxItems: 3,
      items: { type: 'string', maxLength: 140 }
    })
    expect(checks.properties.notes).toEqual({ type: ['string', 'null'], maxLength: 180 })
    expect(findings.required).toEqual([
      'title',
      'type',
      'summary',
      'severity',
      'priority',
      'expectedResult',
      'actualResult',
      'evidence',
      'followUp'
    ])
    expect(findings.properties.type.enum).toEqual(['bug', 'risk', 'question', 'follow_up', 'note'])
    expect(findings.properties.evidence).toEqual({
      type: ['array', 'null'],
      maxItems: 3,
      items: { type: 'string', maxLength: 140 }
    })
    expect(bugs.required).toEqual(['title', 'stepsToReproduce', 'expectedResult', 'actualResult', 'evidence'])
    expect(generatedReportJsonSchema.properties.bugs.maxItems).toBe(3)
    expect(bugs.properties.stepsToReproduce.maxItems).toBe(6)
    expect(bugs.properties.evidence).toEqual({
      type: ['array', 'null'],
      maxItems: 3,
      items: { type: 'string', maxLength: 140 }
    })
    expect(jiraBugDrafts.required).toEqual([
      'summary',
      'description',
      'stepsToReproduce',
      'expectedResult',
      'actualResult',
      'evidence'
    ])
    expect(generatedReportJsonSchema.properties.jiraBugDrafts.maxItems).toBe(3)
    expect(jiraBugDrafts.properties.stepsToReproduce.maxItems).toBe(6)
    expect(jiraBugDrafts.properties.evidence).toEqual({
      type: ['array', 'null'],
      maxItems: 3,
      items: { type: 'string', maxLength: 140 }
    })
  })

  it('accepts nullable structured output fields', () => {
    expect(
      generatedReportSchema.parse({
        whatWasTested: 'BreedingValuesTable',
        scenariosCovered: [],
        checks: [
          {
            title: 'Data visibility',
            status: 'failed',
            expectedResult: 'Data is visible',
            actualResult: 'No data is visible',
            evidence: null,
            notes: null
          }
        ],
        findings: [
          {
            title: 'No data shown',
            type: 'bug',
            summary: 'Data is not visible in the table.',
            severity: null,
            priority: null,
            expectedResult: 'Data is visible',
            actualResult: 'No data is visible',
            evidence: null,
            followUp: null
          }
        ],
        bugs: [
          {
            title: 'No data shown',
            stepsToReproduce: [],
            expectedResult: 'Data is visible',
            actualResult: 'No data is visible',
            evidence: null
          }
        ],
        openQuestions: [],
        followUpActions: [],
        jiraBugDrafts: [
          {
            summary: 'No data shown',
            description: 'Data is not visible in the table.',
            stepsToReproduce: [],
            expectedResult: 'Data is visible',
            actualResult: 'No data is visible',
            evidence: null
          }
        ]
      })
    ).toEqual(
      expect.objectContaining({
        checks: [expect.objectContaining({ evidence: null, notes: null })],
        findings: [expect.objectContaining({ evidence: null, followUp: null })],
        bugs: [expect.objectContaining({ evidence: null })],
        jiraBugDrafts: [expect.objectContaining({ evidence: null })]
      })
    )
  })

  it('rejects reports that exceed concise output caps', () => {
    const report = fakeGeneratedReport({
      checks: Array.from({ length: 9 }, (_, index) => ({
        title: `Check ${index + 1}`,
        status: 'passed',
        expectedResult: null,
        actualResult: null,
        evidence: null,
        notes: null
      }))
    })

    expect(() => generatedReportSchema.parse(report)).toThrow()
  })

  it('prompts for concrete brevity rules', () => {
    const prompt = buildGenerationPrompt(fakeGenerationContextReview())

    expect(prompt).toContain('whatWasTested is one sentence')
    expect(prompt).toContain('max 5 scenarios, 8 checks, 5 findings')
    expect(prompt).toContain('Use bugs and jiraBugDrafts only for real bugs')
  })

  it('renders the report compactly while preserving Jira draft data for parsing', () => {
    const markdown = renderGeneratedReport(fakeGeneratedReport())

    expect(markdown).toContain('- [failed] Data visibility')
    expect(markdown).not.toContain('## Bugs')
    expect(markdown).toContain('## Jira Bug Drafts')
    expect(markdown).not.toContain('### [failed] Data visibility')
  })
})

function fakeGeneratedReport(input: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    whatWasTested: 'BreedingValuesTable data visibility.',
    scenariosCovered: ['Data visibility'],
    checks: [
      {
        title: 'Data visibility',
        status: 'failed',
        expectedResult: 'Data is visible',
        actualResult: 'No data is visible',
        evidence: null,
        notes: null
      }
    ],
    findings: [
      {
        title: 'No data shown',
        type: 'bug',
        summary: 'Data is not visible in the table.',
        severity: null,
        priority: null,
        expectedResult: 'Data is visible',
        actualResult: 'No data is visible',
        evidence: null,
        followUp: null
      }
    ],
    bugs: [
      {
        title: 'No data shown',
        stepsToReproduce: [],
        expectedResult: 'Data is visible',
        actualResult: 'No data is visible',
        evidence: null
      }
    ],
    openQuestions: [],
    followUpActions: [],
    jiraBugDrafts: [
      {
        summary: 'No data shown',
        description: 'Data is not visible in the table.',
        stepsToReproduce: [],
        expectedResult: 'Data is visible',
        actualResult: 'No data is visible',
        evidence: null
      }
    ],
    ...input
  }
}

function fakeGenerationContextReview(): GenerationContextReview {
  return {
    context: {
      id: 'context-1',
      sessionId: 'session-1',
      createdAt: '2026-06-15T00:02:00.000Z'
    },
    session: {
      id: 'session-1',
      title: 'Checkout smoke',
      testTarget: 'Checkout',
      charter: 'Verify checkout completion',
      environment: null,
      buildVersion: null,
      relatedReference: null,
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
      lastOpenedAt: '2026-06-15T00:00:00.000Z'
    },
    entries: [],
    attachments: [],
    findings: []
  }
}
