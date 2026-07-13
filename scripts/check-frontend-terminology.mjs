#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const FORBIDDEN_SESSION_LANGUAGE = [
  { label: 'Session title state named as Note', pattern: /\b(?:noteTitle|setNoteTitle|onSetNoteTitle|noteTitleWriteVersionRef|nextUntitledNoteTitle)\b/g },
  { label: 'Session view named as Notes', pattern: /(?:MainView[^\n]*'notes'|activeView[^\n]*'notes')/g },
  { label: 'Session busy action named as Note', pattern: /\b(?:open-note|new-note|delete-note)\b/g },
  { label: 'Session CSS named as Note', pattern: /\b(?:note-picker|note-workspace|empty-note-actions|note-title-input)\b/g },
  { label: 'Session navigation presented as Notes', pattern: /(?:label|aria-label)=["']Notes["']/g },
  { label: 'Session action presented as Note', pattern: /\b(?:New note|Search notes|Choose note|No matching notes|Load all notes|All notes|No note selected|Delete note|Untitled note|Note title)\b/g },
  { label: 'Session delete discriminator named as Note', pattern: /kind:\s*'note';\s*session:/g },
]

function sourceFiles(root) {
  const files = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.(?:css|ts|tsx)$/.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name) && entry.name !== 'bindings.ts') files.push(path)
    }
  }
  visit(root)
  return files.sort()
}

export function inspectFrontendTerminology(root) {
  const failures = []
  for (const absolutePath of sourceFiles(root)) {
    const contents = readFileSync(absolutePath, 'utf8')
    const repositoryPath = relative(resolve('.'), absolutePath).split(sep).join('/')
    for (const rule of FORBIDDEN_SESSION_LANGUAGE) {
      for (const match of contents.matchAll(rule.pattern)) {
        const line = contents.slice(0, match.index).split('\n').length
        failures.push({ path: repositoryPath, line, label: rule.label, match: match[0] })
      }
    }
  }
  return failures
}

export function run() {
  const failures = inspectFrontendTerminology(resolve('frontend/src'))
  for (const failure of failures) console.error(`FAIL ${failure.path}:${failure.line} ${failure.label}: ${JSON.stringify(failure.match)}`)
  if (failures.length > 0) {
    console.error(`Frontend terminology check found ${failures.length} Session/Note regression(s).`)
    process.exitCode = 1
  } else {
    console.log('Frontend terminology is aligned: Session-facing names use Session and genuine Note Entry language remains allowed.')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) run()
