#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { formatStartupBudgets } from './startup-benchmark-budget.mjs'

const root = resolve('.')
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
  )
}

if (existsSync(startupPath)) {
  const report = JSON.parse(readFileSync(startupPath, 'utf8'))
  sections.push(
    '### Large-fixture startup',
    `- Runner: ${report.runnerClass}`,
    `- Fixture: ${report.fixture.sessions} Sessions, ${report.fixture.activeDrafts} Testware records, ${report.fixture.activeFindings} Findings, ${report.fixture.aiRuns} AI Runs`,
    `- Cold first paint: ${report.summary.coldFirstPaintMs.toFixed(1)}ms`,
    `- Warm first paint p50 / p95: ${report.summary.warmFirstPaintP50Ms.toFixed(1)}ms / ${report.summary.warmFirstPaintP95Ms.toFixed(1)}ms`,
    `- Large-Note editor input p50 / p95: ${report.summary.editorInputP50Ms.toFixed(1)}ms / ${report.summary.editorInputP95Ms.toFixed(1)}ms`,
    `- Production JavaScript: ${(report.productionBundle.javascriptBytes / 1_024).toFixed(1)} KiB raw / ${(report.productionBundle.javascriptGzipBytes / 1_024).toFixed(1)} KiB gzip`,
    `- Budget: ${formatStartupBudgets(report)}`,
  )
}

if (sections.length === 1) sections.push('No E2E or startup artifacts were produced before validation stopped.')
const summary = `${sections.join('\n')}\n`
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
else process.stdout.write(summary)
