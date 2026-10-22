#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { formatStartupBudgets } from './startup-benchmark-budget.mjs'

export function qualitySummary(root = resolve('.'), environment = process.env) {
  const sections = ['## QA Scribe quality evidence']
  const e2ePath = resolve(root, 'artifacts/e2e/latest-run.json')
  const startupPath = resolve(root, 'artifacts/startup/startup-report.json')

  if (existsSync(e2ePath)) {
    const run = JSON.parse(readFileSync(e2ePath, 'utf8'))
    sections.push(
      '### Built application E2E',
      `- Status: ${run.status}`,
      `- Duration: ${(run.durationMs / 1_000).toFixed(1)}s`,
      `- Runner: ${run.runnerClass || `${run.platform}-${run.architecture || 'unknown'}`}`,
      `- Workflow attempt: ${run.runAttempt ?? 1}`,
      `- Invocations: ${run.invocations.length} / ${run.plannedInvocations?.length ?? 'unknown'} planned`,
      '- Receipt: `artifacts/e2e/latest-run.json`',
    )
    addCommands(sections, run.commands, run.firstFailure)
  }

  if (existsSync(startupPath)) {
    const report = JSON.parse(readFileSync(startupPath, 'utf8'))
    sections.push(
      '### Large-fixture startup',
      `- Status: ${report.status ?? 'completed'}`,
      `- Samples retained: ${report.samples.length} / ${report.expectedSamples ?? report.samples.length}`,
      `- Duration: ${(report.durationMs / 1_000).toFixed(1)}s`,
      `- Runner: ${report.runnerClass}`,
      `- Fixture: ${report.fixture.sessions} Sessions, ${report.fixture.activeDrafts} Testware records, ${report.fixture.activeFindings} Findings, ${report.fixture.aiRuns} AI Runs`,
      '- Receipt: `artifacts/startup/startup-report.json`',
      `- Budget: ${formatStartupBudgets(report)}`,
    )
    addCommands(sections, report.commands, report.firstFailure)
    if (report.summary) sections.push(
      `- Cold first paint: ${report.summary.coldFirstPaintMs.toFixed(1)}ms`,
      `- Warm first paint p50 / p95: ${report.summary.warmFirstPaintP50Ms.toFixed(1)}ms / ${report.summary.warmFirstPaintP95Ms.toFixed(1)}ms`,
      `- Large-Note editor input p50 / p95: ${report.summary.editorInputP50Ms.toFixed(1)}ms / ${report.summary.editorInputP95Ms.toFixed(1)}ms`,
    )
    if (report.productionBundle) sections.push(`- Production JavaScript: ${(report.productionBundle.javascriptBytes / 1_024).toFixed(1)} KiB raw / ${(report.productionBundle.javascriptGzipBytes / 1_024).toFixed(1)} KiB gzip`)
  }

  const installationPath = resolve(root, 'artifacts/native-tooling-validation/receipt.json')
  if (existsSync(installationPath)) {
    const receipt = JSON.parse(readFileSync(installationPath, 'utf8'))
    sections.push('### Native tooling installation', `- Platform: ${receipt.platform}`,
      '- Receipt and logs: `artifacts/native-tooling-validation`')
    for (const stage of receipt.stages) {
      sections.push(`- ${stage.stage}: ${stage.status}, cache ${stage.stage === 'cold' ? 'empty' : stage.stage === 'warm' ? `exact restore ${stage.cacheHit}` : 'discarded'}`)
      addCommands(sections, stage.commands, stage.firstFailure)
    }
  }
  if (sections.length === 1) sections.push('No quality artifacts were produced before validation stopped.')
  if (environment.GITHUB_REPOSITORY && environment.GITHUB_RUN_ID) {
    sections.push(`[Run artifacts](${environment.GITHUB_SERVER_URL || 'https://github.com'}/${environment.GITHUB_REPOSITORY}/actions/runs/${environment.GITHUB_RUN_ID}#artifacts)`)
  }
  return `${sections.join('\n')}\n`
}

function addCommands(sections, commands = [], firstFailure) {
  for (const command of commands) sections.push(`- Stage ${command.stage}: ${command.status}, ${(command.elapsedMs / 1_000).toFixed(1)}s`)
  if (!firstFailure) return
  sections.push(`- First failure: ${firstFailure.stage}`)
  if (firstFailure.command) sections.push(`- Command: \`${firstFailure.command.join(' ')}\``,
    `- Exit: ${firstFailure.exitCode ?? 'none'}; signal: ${firstFailure.signal ?? 'none'}; spawn error: ${firstFailure.spawnError?.code ?? 'none'}; timeout: ${firstFailure.timedOut ? `${firstFailure.timeoutMs}ms` : 'no'}`)
  if (firstFailure.message || firstFailure.evidenceError) sections.push(`- Error: ${firstFailure.message ?? firstFailure.evidenceError}`)
  if (firstFailure.spawnError) sections.push(`- Process error: ${firstFailure.spawnError.message}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const summary = qualitySummary()
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  else process.stdout.write(summary)
}
