#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.jsx',
  '.mjs',
  '.py',
  '.rs',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
])
const EXCLUDED_DIRECTORIES = new Set(['.git', 'build', 'dist', 'node_modules', 'out', 'target'])
const GENERATED_FILES = new Set(['frontend/src/bindings.ts'])
const REQUIRED_REVIEW_FIELDS = ['reason', 'splitCost', 'reviewTrigger']

export function physicalLineCount(contents) {
  if (contents.length === 0) return 0
  return contents.endsWith('\n') ? contents.split('\n').length - 1 : contents.split('\n').length
}

export function collectMaintainedFiles(root) {
  const files = []

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(absolutePath)
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        const repositoryPath = relative(root, absolutePath).split(sep).join('/')
        if (!GENERATED_FILES.has(repositoryPath)) files.push(repositoryPath)
      }
    }
  }

  visit(root)
  return files.sort()
}

export function inspectCodeSize(root, policy, today = new Date().toISOString().slice(0, 10)) {
  const exceptions = new Map(policy.exceptions.map((entry) => [entry.path, entry]))
  const exclusions = new Map(policy.excludedFiles.map((entry) => [entry.path, entry]))
  const failures = [
    ...inspectReviewRecords(root, policy.exceptions, 'exception', today),
    ...inspectReviewRecords(root, policy.excludedFiles, 'exclusion', today),
  ]
  const watched = []

  for (const repositoryPath of collectMaintainedFiles(root)) {
    const lineCount = physicalLineCount(readFileSync(join(root, repositoryPath), 'utf8'))
    const exclusion = exclusions.get(repositoryPath)
    const exception = exceptions.get(repositoryPath)

    if (exclusion) continue
    if (lineCount > policy.maxLines) {
      if (!exception) {
        failures.push({ path: repositoryPath, lineCount, reason: 'no approved exception' })
      }
    } else if (lineCount >= policy.watchLines) {
      watched.push({ path: repositoryPath, lineCount })
    }
  }

  return { failures, watched }
}

function inspectReviewRecords(root, records, kind, today) {
  const failures = []
  const seenPaths = new Set()

  for (const record of records) {
    const repositoryPath = typeof record.path === 'string' ? record.path.trim() : ''
    if (!repositoryPath) {
      failures.push({ path: '<missing path>', lineCount: 0, reason: `${kind} is missing path` })
      continue
    }
    if (seenPaths.has(repositoryPath)) {
      failures.push({ path: repositoryPath, lineCount: 0, reason: `duplicate ${kind}` })
    }
    seenPaths.add(repositoryPath)

    for (const field of REQUIRED_REVIEW_FIELDS) {
      if (typeof record[field] !== 'string' || record[field].trim() === '') {
        failures.push({ path: repositoryPath, lineCount: 0, reason: `${kind} is missing ${field}` })
      }
    }

    if (!isIsoDate(record.reviewDate)) {
      failures.push({ path: repositoryPath, lineCount: 0, reason: `${kind} has invalid reviewDate` })
    } else if (record.reviewDate < today) {
      failures.push({ path: repositoryPath, lineCount: 0, reason: `${kind} expired ${record.reviewDate}` })
    }

    if (!statExists(join(root, repositoryPath))) {
      failures.push({ path: repositoryPath, lineCount: 0, reason: `${kind} references a missing file` })
    }
  }

  return failures
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function statExists(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function parseArguments(argv) {
  const rootIndex = argv.indexOf('--root')
  const policyIndex = argv.indexOf('--policy')
  return {
    root: resolve(rootIndex >= 0 ? argv[rootIndex + 1] : '.'),
    policyPath: resolve(policyIndex >= 0 ? argv[policyIndex + 1] : 'scripts/code-size-policy.json'),
  }
}

export function run(argv = process.argv.slice(2)) {
  const { root, policyPath } = parseArguments(argv)
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'))
  const { failures, watched } = inspectCodeSize(root, policy)

  for (const file of watched) console.log(`WATCH ${file.lineCount.toString().padStart(4)} ${file.path}`)
  for (const file of failures) console.error(`FAIL  ${file.lineCount.toString().padStart(4)} ${file.path}: ${file.reason}`)

  console.log(`Code-size policy: ${failures.length} failure(s), ${watched.length} file(s) in the ${policy.watchLines}-${policy.maxLines} watch range.`)
  if (failures.length > 0) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) run()
