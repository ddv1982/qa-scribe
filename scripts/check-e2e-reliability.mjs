#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

const ARTIFACT_PATTERN = /^qa-scribe-e2e(?:-(macos))?-(passed|failed)-(\d+)-(\d+)$/
const SUPPORTED_PLATFORMS = new Set(['linux', 'macos'])

function parseEvidence(artifact) {
  const match = ARTIFACT_PATTERN.exec(artifact.name)
  if (!match) return null
  return {
    platform: match[1] ?? 'linux',
    status: match[2],
    runId: match[3],
    runAttempt: Number(match[4]),
    createdAt: artifact.created_at,
    expired: artifact.expired,
  }
}

export function assessReliability(artifacts, requiredRuns = 20, platform = 'linux') {
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error(`Unsupported E2E platform: ${platform}`)
  const newestByRun = new Map()
  const records = artifacts
    .map(parseEvidence)
    .filter((record) => record && !record.expired && record.platform === platform)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))

  for (const record of records) {
    const existing = newestByRun.get(record.runId)
    if (!existing || record.runAttempt > existing.runAttempt || record.createdAt > existing.createdAt) {
      newestByRun.set(record.runId, record)
    }
  }
  const executions = [...newestByRun.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, requiredRuns)
  const failures = []
  if (executions.length < requiredRuns) failures.push(`only ${executions.length} of ${requiredRuns} ${platform} E2E executions have retained evidence`)
  for (const execution of executions) {
    if (execution.status !== 'passed') failures.push(`run ${execution.runId} failed`)
    if (execution.runAttempt !== 1) failures.push(`run ${execution.runId} required attempt ${execution.runAttempt}`)
  }
  return { executions, failures, ready: failures.length === 0 && executions.length === requiredRuns }
}

export async function listArtifacts(repository, token, fetchImpl = fetch, requiredRuns = 20, platform = 'linux') {
  const artifacts = []
  for (let page = 1; ; page += 1) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/artifacts?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) throw new Error(`GitHub artifact query failed: ${response.status} ${await response.text()}`)
    const pageResult = await response.json()
    if (!Array.isArray(pageResult.artifacts)) throw new Error('GitHub artifact query returned no artifact list')
    artifacts.push(...pageResult.artifacts)
    if (distinctEvidenceRuns(artifacts, platform) >= requiredRuns) break
    if (pageResult.artifacts.length < 100) break
  }
  return artifacts
}

function distinctEvidenceRuns(artifacts, platform) {
  return new Set(
    artifacts
      .map(parseEvidence)
      .filter((record) => record && !record.expired && record.platform === platform)
      .map((record) => record.runId),
  ).size
}

export function requestedPlatform(argv) {
  let platform = 'linux'
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--platform') {
      platform = argv[index + 1]
      index += 1
    } else if (argument.startsWith('--platform=')) {
      platform = argument.slice('--platform='.length)
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error(`Unsupported E2E platform: ${platform || '(missing)'}`)
  return platform
}

export async function run(environment = process.env, argv = process.argv.slice(2)) {
  const repository = environment.GITHUB_REPOSITORY
  const token = environment.GH_TOKEN || environment.GITHUB_TOKEN
  if (!repository || !token) throw new Error('Set GITHUB_REPOSITORY and GH_TOKEN to audit E2E promotion readiness.')
  const platform = requestedPlatform(argv)
  const assessment = assessReliability(await listArtifacts(repository, token, fetch, 20, platform), 20, platform)
  for (const execution of assessment.executions) {
    console.log(`${platform.toUpperCase()} ${execution.status.toUpperCase()} run=${execution.runId} attempt=${execution.runAttempt} created=${execution.createdAt}`)
  }
  if (!assessment.ready) {
    for (const failure of assessment.failures) console.error(`NOT READY: ${failure}`)
    process.exitCode = 1
  } else {
    console.log(`READY: 20 consecutive ${platform} built-app E2E gates passed on their first attempt.`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
