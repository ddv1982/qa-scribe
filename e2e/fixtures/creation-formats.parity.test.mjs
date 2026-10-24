import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const starters = JSON.parse(readFileSync(new URL('../../shared/creation-starters.json', import.meta.url), 'utf8'))
const rust = readFileSync(new URL('../../crates/qa-scribe-core/src/generation/preferences.rs', import.meta.url), 'utf8')
for (const [id, variant] of [
  ['qa_cases', 'QaCases'],
  ['checklist', 'Checklist'],
  ['gherkin', 'Gherkin'],
  ['charters', 'Charters'],
  ['coverage_outline', 'CoverageOutline'],
]) {
  test(`pins the ${id} manual starter to its Rust output guidance`, () => {
    const guidance = rust.match(new RegExp(`TestwareOutputFormat::${variant} => \\{\\s*"([^"]+)"`))?.[1]
    assert.ok(guidance)
    assert.equal(starters.testwareFormats[id].guidance, guidance)
  })
}
