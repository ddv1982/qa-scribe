#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const REQUIRED_TEXT_FIELDS = ['exposure', 'dependencyPath', 'blocker', 'reviewDate', 'removalTrigger']

export function auditFindings(report) {
  const findings = report.vulnerabilities.list.map((entry) => ({
    id: entry.advisory.id,
    classification: 'vulnerability',
    package: entry.package.name,
    version: entry.package.version,
  }))

  for (const entries of Object.values(report.warnings)) {
    for (const entry of entries) {
      findings.push({
        id: entry.advisory.id,
        classification: entry.advisory.informational ?? 'warning',
        package: entry.package.name,
        version: entry.package.version,
      })
    }
  }
  return findings.sort((left, right) => left.id.localeCompare(right.id))
}

export function compareAudit(report, registry, today = new Date().toISOString().slice(0, 10)) {
  const errors = []
  const registered = new Map()

  if (!isIsoDate(registry.reviewedAt)) errors.push('registry reviewedAt must be an ISO date')
  else if (registry.reviewedAt > today) errors.push(`registry reviewedAt is in the future ${registry.reviewedAt}`)
  if (!isIsoDate(registry.nextReviewDate)) errors.push('registry nextReviewDate must be an ISO date')

  for (const exception of registry.exceptions) {
    if (registered.has(exception.id)) errors.push(`${exception.id}: duplicate registry entry`)
    registered.set(exception.id, exception)
    for (const field of REQUIRED_TEXT_FIELDS) {
      if (typeof exception[field] !== 'string' || exception[field].trim() === '') errors.push(`${exception.id}: missing ${field}`)
    }
    if (!Array.isArray(exception.targets) || exception.targets.length === 0 || exception.targets.some((target) => typeof target !== 'string' || target.trim() === '')) {
      errors.push(`${exception.id}: missing targets`)
    }
    if (!Array.isArray(exception.patchedVersions) || exception.patchedVersions.some((version) => typeof version !== 'string' || version.trim() === '')) {
      errors.push(`${exception.id}: patchedVersions must be an array of versions`)
    }
    if (!isIsoDate(exception.reviewDate)) errors.push(`${exception.id}: reviewDate must be an ISO date`)
    else if (exception.reviewDate < today) errors.push(`${exception.id}: review expired ${exception.reviewDate}`)
  }

  const actual = auditFindings(report)
  const actualIds = new Set(actual.map((finding) => finding.id))
  for (const finding of actual) {
    const exception = registered.get(finding.id)
    if (!exception) {
      errors.push(`${finding.id}: new ${finding.classification} in ${finding.package} ${finding.version}`)
      continue
    }
    for (const field of ['classification', 'package', 'version']) {
      if (exception[field] !== finding[field]) errors.push(`${finding.id}: registry ${field} ${exception[field]} does not match audit ${finding[field]}`)
    }
  }
  for (const id of registered.keys()) {
    if (!actualIds.has(id)) errors.push(`${id}: registry entry is stale because cargo-audit no longer reports it`)
  }

  if (isIsoDate(registry.nextReviewDate) && registry.nextReviewDate < today) errors.push(`registry review expired ${registry.nextReviewDate}`)
  return { errors, findings: actual }
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function auditSummaryLine(findings) {
  const counts = findings.reduce((result, finding) => {
    result[finding.classification] = (result[finding.classification] ?? 0) + 1
    return result
  }, {})
  const vulnerabilities = counts.vulnerability ?? 0
  const unsound = counts.unsound ?? 0
  const unmaintained = counts.unmaintained ?? 0
  return `A raw \`cargo audit --json\` run on 2026-07-13 reports ${findings.length} reviewed advisories: ${vulnerabilities} ${vulnerabilities === 1 ? 'vulnerability' : 'vulnerabilities'}, ${unsound} unsoundness ${unsound === 1 ? 'warning' : 'warnings'}, and ${unmaintained} unmaintained ${unmaintained === 1 ? 'warning' : 'warnings'}.`
}

export function run() {
  const registry = JSON.parse(readFileSync('scripts/rust-audit-exceptions.json', 'utf8'))
  const audit = spawnSync('cargo', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (audit.error) throw audit.error
  if (!audit.stdout.trim()) {
    process.stderr.write(audit.stderr)
    throw new Error(`cargo audit produced no JSON (exit ${audit.status})`)
  }

  const report = JSON.parse(audit.stdout)
  const { errors, findings } = compareAudit(report, registry)
  const auditDocumentation = readFileSync('docs/rust-dependency-audit.md', 'utf8')
  const expectedSummary = auditSummaryLine(findings)
  if (!auditDocumentation.includes(expectedSummary)) errors.push('docs/rust-dependency-audit.md summary does not match cargo-audit')
  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL ${error}`)
    process.exitCode = 1
    return
  }

  const counts = findings.reduce((result, finding) => {
    result[finding.classification] = (result[finding.classification] ?? 0) + 1
    return result
  }, {})
  console.log(`Rust audit registry is current: ${findings.length} reviewed finding(s) (${Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(', ')}).`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) run()
