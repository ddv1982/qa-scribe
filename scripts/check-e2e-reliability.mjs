#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

const ARTIFACT_PATTERN = /^qa-scribe-e2e-(passed|failed)-(\d+)-(\d+)$/

export function assessReliability(artifacts, requiredRuns = 20) {
  const newestByRun = new Map()
  const records = artifacts
    .map((artifact) => {
      const match = ARTIFACT_PATTERN.exec(artifact.name)
      if (!match) return null
      return {
        status: match[1],
        runId: match[2],
        runAttempt: Number(match[3]),
        createdAt: artifact.created_at,
        expired: artifact.expired,
      }
    })
    .filter((record) => record && !record.expired)
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
  if (executions.length < requiredRuns) failures.push(`only ${executions.length} of ${requiredRuns} required-gate executions have retained evidence`)
  for (const execution of executions) {
    if (execution.status !== 'passed') failures.push(`run ${execution.runId} failed`)
    if (execution.runAttempt !== 1) failures.push(`run ${execution.runId} required attempt ${execution.runAttempt}`)
  }
  return { executions, failures, ready: failures.length === 0 && executions.length === requiredRuns }
}

export async function listArtifacts(repository, token, fetchImpl = fetch, requiredRuns = 20) {
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
    if (distinctEvidenceRuns(artifacts) >= requiredRuns) break
    if (pageResult.artifacts.length < 100) break
  }
  return artifacts
}

function distinctEvidenceRuns(artifacts) {
  return new Set(
    artifacts
      .filter((artifact) => !artifact.expired && ARTIFACT_PATTERN.test(artifact.name))
      .map((artifact) => ARTIFACT_PATTERN.exec(artifact.name)?.[2]),
  ).size
}

export async function run(environment = process.env) {
  const repository = environment.GITHUB_REPOSITORY
  const token = environment.GH_TOKEN || environment.GITHUB_TOKEN
  if (!repository || !token) throw new Error('Set GITHUB_REPOSITORY and GH_TOKEN to audit E2E promotion readiness.')
  const assessment = assessReliability(await listArtifacts(repository, token))
  for (const execution of assessment.executions) {
    console.log(`${execution.status.toUpperCase()} run=${execution.runId} attempt=${execution.runAttempt} created=${execution.createdAt}`)
  }
  if (!assessment.ready) {
    for (const failure of assessment.failures) console.error(`NOT READY: ${failure}`)
    process.exitCode = 1
  } else {
    console.log('READY: 20 consecutive built-app E2E gates passed on their first attempt.')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
