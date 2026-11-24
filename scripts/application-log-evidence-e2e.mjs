import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

export const askAiLogSpec = 'ask-ai-test-run-logs.e2e.mjs'
export const logEvidenceSpec = 'test-run-log-evidence.e2e.mjs'

export function logEvidenceInvocations(temporaryRoot, artifacts) {
  return ['capture', 'restart'].map((phase, index) => ({
    id: index ? 'test-run-log-evidence-restart' : 'test-run-log-evidence',
    ...(index ? { restartOf: 'test-run-log-evidence' } : {}),
    environment: {
      QA_SCRIBE_E2E_SPEC: logEvidenceSpec,
      QA_SCRIBE_E2E_LOG_PHASE: phase,
      QA_SCRIBE_E2E_APP_DATA_DIR: join(temporaryRoot, 'app-data'),
      QA_SCRIBE_E2E_ARTIFACTS: join(artifacts, phase),
      QA_SCRIBE_E2E_FIXTURE_DIR: join(temporaryRoot, 'fixtures'),
      AZURE_CONFIG_DIR: join(temporaryRoot, 'azure-config'),
    },
  }))
}

export function askAiLogInvocations(temporaryRoot, artifacts) {
  return ['codex', 'claude'].map((provider) => ({
    id: `ask-ai-logs-${provider}`,
    environment: {
      QA_SCRIBE_E2E_SPEC: askAiLogSpec,
      QA_SCRIBE_E2E_LOG_PROVIDER: provider,
      QA_SCRIBE_E2E_APP_DATA_DIR: join(temporaryRoot, provider, 'app-data'),
      QA_SCRIBE_E2E_ARTIFACTS: join(artifacts, provider),
      QA_SCRIBE_E2E_FIXTURE_DIR: join(temporaryRoot, provider, 'fixtures'),
      AZURE_CONFIG_DIR: join(temporaryRoot, provider, 'azure-config'),
    },
  }))
}

export function installAzFixture(environment, fixtureBin, providerBin) {
  if (![logEvidenceSpec, askAiLogSpec].includes(environment.QA_SCRIBE_E2E_SPEC)) return
  mkdirSync(environment.AZURE_CONFIG_DIR, { recursive: true, mode: 0o700 })
  const az = join(providerBin, 'az')
  rmSync(az, { force: true })
  symlinkSync(join(fixtureBin, 'az'), az)
}
