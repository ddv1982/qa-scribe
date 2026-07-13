import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectFrontendTerminology } from './check-frontend-terminology.mjs'

test('terminology check rejects Session concepts presented as Note', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-terminology-'))
  try {
    writeFileSync(join(root, 'App.tsx'), "const noteTitle = 'Untitled note'\n")
    const failures = inspectFrontendTerminology(root)
    assert.deepEqual(failures.map((failure) => failure.label), [
      'Session title state named as Note',
      'Session action presented as Note',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('terminology check permits genuine Note Entry and generation language', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-terminology-'))
  try {
    mkdirSync(join(root, 'editor'))
    writeFileSync(join(root, 'editor/Note.tsx'), "const noteEntry = 'Note body'; const action = 'Summarize note'\n")
    assert.deepEqual(inspectFrontendTerminology(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
