import type { Draft, TestwareDepth, TestwareGenerationPreferences, TestwareOutputFormat, TestwareTechnique } from '../tauri'

export type TestwareTechniquePreset = {
  id: TestwareTechnique
  label: string
  shortLabel: string
  bestFor: string
  description: string
}

export const defaultTestwareGenerationPreferences: TestwareGenerationPreferences = {
  technique: 'auto',
  outputFormat: 'qa_cases',
  depth: 'balanced',
  includeNegativeCases: true,
  includeBoundaryCases: true,
  includeTestData: true,
  preserveEvidence: true,
  customInstructions: null,
}

export const testwareTechniquePresets: TestwareTechniquePreset[] = [
  {
    id: 'auto',
    label: 'Auto-select',
    shortLabel: 'Auto',
    bestFor: 'Mixed notes',
    description: 'Let QA Scribe choose the strongest coverage technique from the note.',
  },
  {
    id: 'use_case',
    label: 'Use case flows',
    shortLabel: 'Flows',
    bestFor: 'Journeys',
    description: 'Cover happy paths, alternates, exceptions, and end-to-end behavior.',
  },
  {
    id: 'equivalence_boundary',
    label: 'Equivalence and boundary',
    shortLabel: 'Boundaries',
    bestFor: 'Inputs',
    description: 'Group valid and invalid partitions, then check relevant edges.',
  },
  {
    id: 'decision_table',
    label: 'Decision table',
    shortLabel: 'Rules',
    bestFor: 'Business rules',
    description: 'Map conditions, actions, and combinations without losing rule coverage.',
  },
  {
    id: 'state_transition',
    label: 'State transition',
    shortLabel: 'States',
    bestFor: 'Workflows',
    description: 'Exercise valid and invalid movement between states and recovery paths.',
  },
  {
    id: 'pairwise',
    label: 'Pairwise coverage',
    shortLabel: 'Pairwise',
    bestFor: 'Combinations',
    description: 'Compress parameter combinations into a practical high-signal set.',
  },
  {
    id: 'risk_based',
    label: 'Risk-based',
    shortLabel: 'Risk',
    bestFor: 'Triage',
    description: 'Prioritize by impact, likelihood, complexity, and likely failure cost.',
  },
  {
    id: 'exploratory',
    label: 'Exploratory charters',
    shortLabel: 'Charters',
    bestFor: 'Discovery',
    description: 'Create focused missions, risks, data needs, and observation prompts.',
  },
  {
    id: 'bdd',
    label: 'BDD scenarios',
    shortLabel: 'BDD',
    bestFor: 'Acceptance',
    description: 'Shape behavior as Given/When/Then scenarios for stakeholder review.',
  },
]

export const testwareOutputFormatOptions: Array<{ id: TestwareOutputFormat; label: string; description: string }> = [
  { id: 'qa_cases', label: 'QA cases', description: 'Scenario groups with steps, data, and expected results.' },
  { id: 'checklist', label: 'Checklist', description: 'Compact executable checks.' },
  { id: 'gherkin', label: 'Gherkin', description: 'Feature and scenario style behavior.' },
  { id: 'charters', label: 'Charters', description: 'Exploratory testing missions.' },
  { id: 'coverage_outline', label: 'Coverage outline', description: 'Coverage map plus concrete cases.' },
]

export const testwareDepthOptions: Array<{ id: TestwareDepth; label: string; description: string }> = [
  { id: 'lean', label: 'Lean', description: '3-5 high-value cases.' },
  { id: 'balanced', label: 'Balanced', description: '6-10 practical cases.' },
  { id: 'thorough', label: 'Thorough', description: '10-16 broader cases when supported.' },
]

export function testwareTechniqueLabel(technique: TestwareTechnique): string {
  return testwareTechniquePresets.find((preset) => preset.id === technique)?.shortLabel ?? technique
}

export function testwareOutputFormatLabel(format: TestwareOutputFormat): string {
  return testwareOutputFormatOptions.find((option) => option.id === format)?.label ?? format
}

export function testwareDepthLabel(depth: TestwareDepth): string {
  return testwareDepthOptions.find((option) => option.id === depth)?.label ?? depth
}

export function parseTestwareGenerationMetadata(draft: Pick<Draft, 'metadataJson'>): TestwareGenerationPreferences | null {
  if (!draft.metadataJson) return null
  try {
    const parsed = JSON.parse(draft.metadataJson) as { testwareGeneration?: Partial<TestwareGenerationPreferences> }
    const metadata = parsed.testwareGeneration
    if (!metadata || !metadata.technique || !metadata.outputFormat || !metadata.depth) return null
    return {
      ...defaultTestwareGenerationPreferences,
      ...metadata,
      customInstructions: metadata.customInstructions ?? null,
    }
  } catch {
    return null
  }
}
