import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readIsolationEvidence(path, phase) {
  try {
    const receipt = JSON.parse(readFileSync(path, 'utf8'))
    const expected = [1, 2, 3, 4, 5, 6]
    if (receipt.phase !== phase || receipt.completed !== true || receipt.scenarios?.length !== expected.length
      || receipt.scenarios.some((scenario, index) => scenario.id !== expected[index] || scenario.status !== 'passed')) return null
    return receipt
  } catch { return null }
}

export function isolationInvocations(temporaryRoot, artifacts) {
  return [{
    id: 'ask-ai-isolation-initial',
    environment: {
      QA_SCRIBE_E2E_SPEC: 'ask-ai-conversation-isolation.e2e.mjs',
      QA_SCRIBE_E2E_ISOLATION_PHASE: 'initial',
      QA_SCRIBE_E2E_APP_DATA_DIR: join(temporaryRoot, 'app-data', 'ask-ai-isolation'),
      QA_SCRIBE_E2E_ARTIFACTS: join(artifacts, 'ask-ai-isolation', 'initial'),
      QA_SCRIBE_E2E_FIXTURE_DIR: join(temporaryRoot, 'fixtures', 'ask-ai-isolation'),
    },
  }]
}
