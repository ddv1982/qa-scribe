import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { parseDocument, isMap, isSeq, isScalar, isAlias, visit } = require('yaml')

export function readWorkflowToolVersions(data = JSON.parse(readFileSync(new URL('./tool-versions.json', import.meta.url), 'utf8'))) {
  const pins = {}
  for (const name of ['actionlint', 'zizmor']) {
    if (typeof data[name] !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(data[name])) {
      throw new Error(`Expected stable ${name} version pin`)
    }
    pins[name] = data[name]
  }
  return pins
}

// actionlint 1.7.12 lacks $/ support (upstream issue 711, PR 732).
// Only its stdin view changes. Never stringify YAML or write workflow sources.
export function normalizeWorkflowSource(source) {
  const document = parseDocument(source, { uniqueKeys: true })
  if (document.errors.length) throw new Error(`Invalid workflow YAML: ${document.errors.map(error => error.message).join('; ')}`)
  // Current workflows use neither anchors nor aliases. Reject globally rather
  // than resolve shared nodes whose source range could serve unrelated paths.
  visit(document, (_, node) => {
    if (isAlias(node) || node?.anchor) throw new Error('Unsupported workflow YAML alias or anchor')
  })
  const offsets = []
  function mapping(node, path) {
    if (!isMap(node)) throw new Error(`Expected mapping at ${path}`)
    if (node.items.some(pair => isScalar(pair.key) && pair.key.value === '<<')) {
      throw new Error(`Unsupported workflow YAML merge key at ${path}`)
    }
    return node
  }
  function reference(map, path) {
    if (!map.has('uses')) return
    const node = map.get('uses', true)
    if (!isScalar(node)) throw new Error(`Expected scalar at ${path}.uses`)
    if (typeof node.value !== 'string' || !node.value.startsWith('$/')) return
    const quoted = node.type === 'QUOTE_SINGLE' || node.type === 'QUOTE_DOUBLE'
    const raw = source.slice(node.range[0], node.range[1])
    const literal = quoted ? raw.slice(1, -1) : raw
    if (node.tag || (!quoted && node.type !== 'PLAIN') || literal !== node.value) {
      throw new Error(`Unsupported self-reference representation at ${path}.uses`)
    }
    const offset = node.range[0] + Number(quoted)
    if (source.slice(offset, offset + 2) !== '$/') throw new Error(`Nonliteral self-reference at ${path}.uses`)
    offsets.push(offset)
  }
  const workflow = mapping(document.contents, 'workflow')
  if (workflow.has('jobs')) {
    const jobs = mapping(workflow.get('jobs', true), 'jobs')
    for (const pair of jobs.items) {
      const path = `jobs.${pair.key?.value}`
      const job = mapping(pair.value, path)
      reference(job, path)
      if (!job.has('steps')) continue
      const steps = job.get('steps', true)
      if (!isSeq(steps)) throw new Error(`Expected sequence at ${path}.steps`)
      steps.items.forEach((step, index) => reference(mapping(step, `${path}.steps[${index}]`), `${path}.steps[${index}]`))
    }
  }
  let normalized = source
  for (const offset of offsets) normalized = normalized.slice(0, offset) + '.' + normalized.slice(offset + 1)
  return normalized
}

export function checkWorkflows(root = process.cwd(), spawn = spawnSync) {
  const pins = readWorkflowToolVersions()
  const version = spawn('actionlint', ['--version'], { cwd: root, encoding: 'utf8' })
  if (version.stdout) process.stdout.write(version.stdout)
  if (version.stderr) process.stderr.write(version.stderr)
  if (version.error) throw version.error
  if (version.status !== 0) throw new Error(`actionlint --version failed with status ${version.status}`)
  if (version.stdout.split(/\r?\n/)[0] !== pins.actionlint) throw new Error(`Expected actionlint ${pins.actionlint}`)
  const directory = resolve(root, '.github/workflows')
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.ya?ml$/.test(entry.name)).map(entry => entry.name).sort()
  if (!files.length) throw new Error('No workflow YAML files found')
  let status = 0
  for (const file of files) {
    const relativePath = `.github/workflows/${file}`
    const input = normalizeWorkflowSource(readFileSync(resolve(root, relativePath), 'utf8'))
    const result = spawn('actionlint', ['-stdin-filename', relativePath, '-'], { input, cwd: root, encoding: 'utf8' })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) throw result.error
    if (result.status === null) throw new Error(`actionlint terminated by ${result.signal}`)
    if (result.status !== 0 && status === 0) status = result.status
  }
  return status
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === '--github-output') {
      const pins = readWorkflowToolVersions()
      process.stdout.write(`actionlint=${pins.actionlint}\nzizmor=${pins.zizmor}\n`)
    } else if (args.length === 0) {
      process.exitCode = checkWorkflows()
    } else {
      throw new Error('Usage: node scripts/check-workflows.mjs [--github-output]')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
