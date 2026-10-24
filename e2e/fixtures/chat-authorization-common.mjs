import { existsSync, linkSync, mkdirSync, unlinkSync, watch, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { handoffMarkdown } from './chat-handoff-markdown.mjs'

export function reserveInvocation(directory, prefix = 'codex-exec') {
  mkdirSync(directory, { recursive: true })
  for (let index = 1; index <= 100; index += 1) {
    try { mkdirSync(join(directory, `${prefix}-${index}.lock`)); return index }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  throw new Error('Fixture invocation limit exceeded')
}

export function waitForFile(path) {
  if (existsSync(path)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const watcher = watch(dirname(path), () => {
      if (existsSync(path)) { watcher.close(); resolve() }
    })
    watcher.on('error', reject)
    if (existsSync(path)) { watcher.close(); resolve() }
  })
}

export function chatResponse(turn) {
  if (turn === 1) return 'Which build and environment did you test?'
  if (turn === 2) return process.env.QA_SCRIBE_E2E_CHAT_MARKDOWN === '1'
    ? handoffMarkdown : 'What did you expect, and what happened instead?'
  return 'Your testing context is ready to submit as a Session Note.'
}

export function parseTranscript(prompt, argv) {
  const separator = '\nTRANSCRIPT_JSON\n'
  const start = prompt.indexOf(separator)
  const labels = start < 0 ? [...prompt.matchAll(/\nMESSAGE \S+ (User|Assistant)\n/g)] : []
  const messages = start >= 0 ? JSON.parse(prompt.slice(start + separator.length)).messages
    : labels.map((label, index) => ({ role: label[1].toLowerCase(),
      text: JSON.parse(prompt.slice(label.index + label[0].length, labels[index + 1]?.index)) }))
  if (!Array.isArray(messages) || !messages.length || messages.length % 2 !== 1) {
    throw new Error('Chat transcript requires completed pairs followed by latest user message')
  }
  for (const [index, message] of messages.entries()) {
    if (message.role !== (index % 2 ? 'assistant' : 'user') || typeof message.text !== 'string' || !message.text.trim()) {
      throw new Error('Invalid Chat role order or text')
    }
    if (message.role === 'assistant' && message.text !== chatResponse((index + 1) / 2)) {
      throw new Error('Chat did not replay deterministic assistant response')
    }
  }
  return { messages, response: chatResponse((messages.length + 1) / 2), argv }
}

export function executeMarker(path) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {record} from ${JSON.stringify(import.meta.url)}; import {dirname,basename} from 'node:path'; record(dirname(process.argv[1]),basename(process.argv[1]),{pid:process.pid,parent:process.ppid})`, path],
  { encoding: 'utf8' })
  if (child.status !== 0) throw new Error(`Marker child failed: ${child.stderr}`)
}

export function jsonLines(handle) {
  let buffered = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffered += chunk
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines.filter((value) => value.trim())) {
      Promise.resolve().then(() => handle(JSON.parse(line))).catch((error) => {
        console.error(error.message)
        process.exit(1)
      })
    }
  })
}

export const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
export function record(directory, name, value) {
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`)
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  try { linkSync(temporary, join(directory, name)) }
  finally { unlinkSync(temporary) }
}
