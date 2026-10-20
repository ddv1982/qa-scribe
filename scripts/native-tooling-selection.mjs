import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'

const extensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])

export function inspectLintSelection(frontend, lintScript, ignored, env = process.env) {
  const expected = []
  const excluded = new Set(ignored)
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) visit(join(directory, entry.name), path)
      else if (entry.isFile() && extensions.has(extname(entry.name))) expected.push(path)
    }
  }
  visit(frontend)
  const [executable, ...args] = lintScript.trim().split(/\s+/)
  assert.equal(executable, 'oxlint', 'File selection must use the actual Oxlint command')
  const result = spawnSync(join(frontend, 'node_modules/.bin/oxlint'), [...args, '--debug=files'], {
    cwd: frontend, encoding: 'utf8', timeout: 30_000, env,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, `Oxlint file selection must succeed: ${result.stdout}${result.stderr}`)
  const selected = result.stdout.split(/\r?\n/).filter(Boolean).map(path => relative(frontend, resolve(frontend, path)).split(sep).join('/'))
  return { expected: expected.sort(), selected: [...new Set(selected)].sort() }
}

export function validateLintSelection({ expected, selected }) {
  const checked = new Set(selected)
  return expected.filter(path => !checked.has(path)).map(path => ({
    code: 'lint-file-coverage', location: path, message: 'Maintained source is excluded from the actual Oxlint command',
  }))
}
