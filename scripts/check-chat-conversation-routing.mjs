import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'frontend/src', 'src-tauri/src', 'crates/qa-scribe-core/src'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const notesEntries = new Set(['frontend/src/app/sessionChat.workspaces.ts', 'frontend/src/tauriCommands.ts', 'frontend/src/bindings.ts', 'src-tauri/src/commands/chat.rs', 'crates/qa-scribe-core/src/services/session_service/chat.rs'])
const testModules = new Set()
for (const file of files.filter(file => file.endsWith('.rs'))) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/#\[cfg\(test\)\]\s*mod (\w+)\s*;/g)) {
    const directory = file.slice(0, file.lastIndexOf('/'))
    const stem = file.slice(0, -3)
    for (const candidate of [`${directory}/${match[1]}.rs`, `${stem}/${match[1]}.rs`, `${stem}/${match[1]}/mod.rs`]) {
      if (files.includes(candidate)) testModules.add(candidate)
    }
  }
}
const findings = []
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const testBoundary = lines.findIndex(line => line.trim() === '#[cfg(test)]')
  lines.forEach((line, index) => {
    if (!/\b(?:getChat|load_chat)\s*\(/.test(line)) return
    const classification = /(?:test|fixture)/i.test(file) || testModules.has(file) || (file.endsWith('.rs') && testBoundary >= 0 && index > testBoundary && !notesEntries.has(file)) ? 'test fixture or assertion' : notesEntries.has(file) ? 'Notes-only entry' : null
    assert.ok(classification, `Unclassified singleton lookup ${file}:${index + 1}`)
    findings.push({ file, line: index + 1, classification, source: line.trim() })
  })
}
console.log(JSON.stringify({ rule: 'Generic execution and recovery use exact ChatRef reads. Singleton lookup is Notes-only.', findings }, null, 2))
