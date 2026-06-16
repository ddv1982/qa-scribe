import { describe, expect, it } from 'vitest'
import { generatedReportJsonSchema, generatedReportSchema } from './generation'

describe('generation schema', () => {
  it('uses required nullable fields for OpenAI strict structured outputs', () => {
    const checks = generatedReportJsonSchema.properties.checks.items
    const findings = generatedReportJsonSchema.properties.findings.items
    const bugs = generatedReportJsonSchema.properties.bugs.items
    const jiraBugDrafts = generatedReportJsonSchema.properties.jiraBugDrafts.items

    expect(checks.required).toEqual(['title', 'status', 'expectedResult', 'actualResult', 'evidence', 'notes'])
    expect(checks.properties.expectedResult).toEqual({ type: ['string', 'null'] })
    expect(checks.properties.actualResult).toEqual({ type: ['string', 'null'] })
    expect(checks.properties.evidence).toEqual({ type: ['array', 'null'], items: { type: 'string' } })
    expect(checks.properties.notes).toEqual({ type: ['string', 'null'] })
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
    expect(findings.properties.evidence).toEqual({ type: ['array', 'null'], items: { type: 'string' } })
    expect(bugs.required).toEqual(['title', 'stepsToReproduce', 'expectedResult', 'actualResult', 'evidence'])
    expect(bugs.properties.evidence).toEqual({ type: ['array', 'null'], items: { type: 'string' } })
    expect(jiraBugDrafts.required).toEqual([
      'summary',
      'description',
      'stepsToReproduce',
      'expectedResult',
      'actualResult',
      'evidence'
    ])
    expect(jiraBugDrafts.properties.evidence).toEqual({ type: ['array', 'null'], items: { type: 'string' } })
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
})
