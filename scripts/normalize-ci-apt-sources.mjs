import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const canonicalUri = 'https://archive.ubuntu.com/ubuntu'
const eligibleUris = new Set([
  'http://azure.archive.ubuntu.com/ubuntu',
  'http://azure.archive.ubuntu.com/ubuntu/',
  'https://azure.archive.ubuntu.com/ubuntu',
  'https://azure.archive.ubuntu.com/ubuntu/',
  'mirror+file:/etc/apt/apt-mirrors.txt',
  'mirror+file:///etc/apt/apt-mirrors.txt',
])

export function normalizeLegacySources(source) {
  let uriCount = 0
  const text = source.replace(/^[ \t]*deb(?:-src)?[ \t]+[^\r\n]*/gm, line => {
    const record = line.match(/^([ \t]*deb(?:-src)?[ \t]+(?:\[[^\]\r\n]*\][ \t]+)?)([^\s#\[]+)([ \t]+[^\s#]+[^\r\n]*)$/)
    if (!record) throw new Error('Invalid legacy APT source record')
    const [, prefix, uri, suffix] = record
    if (!eligibleUris.has(uri)) return line
    uriCount++
    return prefix + canonicalUri + suffix
  })
  return { text, uriCount }
}

export function normalizeDeb822Sources(source) {
  let uriCount = 0
  function stanza(lines) {
    const fields = new Map()
    let field
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (/^[ \t]*#/.test(line)) continue
      if (/^[ \t]/.test(line)) {
        if (!field) throw new Error('Invalid Deb822 continuation without a field')
        field.indices.push(index)
        field.value += ' ' + line.trim()
        continue
      }
      const match = line.match(/^([A-Za-z][A-Za-z0-9-]*):([^\r\n]*)(?:\r?\n)?$/)
      if (!match) throw new Error('Invalid Deb822 APT source field')
      const name = match[1].toLowerCase()
      if (fields.has(name)) throw new Error('Invalid Deb822 duplicate field')
      field = { indices: [index], value: match[2].trim() }
      fields.set(name, field)
    }
    const enabled = fields.get('enabled')?.value.toLowerCase()
    if (enabled !== undefined && enabled !== 'yes' && enabled !== 'no') throw new Error('Invalid Deb822 Enabled value')
    if (enabled === 'no') return lines.join('')
    for (const index of fields.get('uris')?.indices ?? []) {
      const line = lines[index]
      const start = /^[ \t]/.test(line) ? 0 : line.indexOf(':') + 1
      lines[index] = line.slice(0, start) + line.slice(start).replace(/\S+/g, uri => {
        if (!eligibleUris.has(uri)) return uri
        uriCount++
        return canonicalUri
      })
    }
    return lines.join('')
  }
  let pending = []
  let text = ''
  for (const line of source.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (/^[ \t]*(?:\r?\n)?$/.test(line)) {
      text += stanza(pending) + line
      pending = []
    } else {
      pending.push(line)
    }
  }
  text += stanza(pending)
  return { text, uriCount }
}

function normalizeRoot(root) {
  const files = []
  const legacy = join(root, 'sources.list')
  try {
    lstatSync(legacy)
    files.push(legacy)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const directory = join(root, 'sources.list.d')
  let entries = []
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  files.push(...entries.filter(entry => (entry.isFile() || entry.isSymbolicLink()) && /\.(list|sources)$/.test(entry.name))
    .map(entry => join(directory, entry.name)).sort())
  const changes = files.map(path => {
    const source = readFileSync(path, 'utf8')
    const result = path.endsWith('.sources') ? normalizeDeb822Sources(source) : normalizeLegacySources(source)
    return { path, ...result }
  }).filter(result => result.uriCount > 0)
  for (const { path, text } of changes) writeFileSync(path, text)
  const uriCount = changes.reduce((sum, result) => sum + result.uriCount, 0)
  console.log(changes.length
    ? `APT sources normalized: ${changes.length} files, ${uriCount} URIs.`
    : 'APT sources unchanged: no eligible URIs.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      root: { type: 'string' },
      'runner-os': { type: 'string' },
      'runner-environment': { type: 'string' },
    } })
    if (values['runner-os'] !== 'Linux' || values['runner-environment'] !== 'github-hosted') {
      console.log('APT sources unchanged: requires GitHub-hosted Linux.')
    } else {
      if (!values.root) throw new Error('An explicit --root APT configuration directory is required')
      normalizeRoot(values.root)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
