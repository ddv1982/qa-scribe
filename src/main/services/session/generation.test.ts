import { describe, expect, it } from 'vitest'
import { generatedReportJsonSchema, generatedReportSchema } from './generation'

describe('generation schema', () => {
  it('uses required nullable fields for OpenAI strict structured outputs', () => {
    const checks = generatedReportJsonSchema.properties.checks.items
    const bugs = generatedReportJsonSchema.properties.bugs.items
    const jiraBugDrafts = generatedReportJsonSchema.properties.jiraBugDrafts.items

    expect(checks.required).toEqual(['title', 'status', 'notes'])
    expect(checks.properties.notes).toEqual({ type: ['string', 'null'] })
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
        checks: [{ title: 'Data visibility', status: 'failed', notes: null }],
        findings: [],
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
        checks: [expect.objectContaining({ notes: null })],
        bugs: [expect.objectContaining({ evidence: null })],
        jiraBugDrafts: [expect.objectContaining({ evidence: null })]
      })
    )
  })
})
