import { existsSync, mkdirSync, watch, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

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
  if (turn === 2) return 'What did you expect, and what happened instead?'
  return 'Your testing context is ready to submit as a Session Note.'
}

export function parseTranscript(prompt, argv) {
  const separator = '\nTRANSCRIPT_JSON\n'
  const start = prompt.indexOf(separator)
  if (start < 0) throw new Error('Chat prompt is missing TRANSCRIPT_JSON data')
  const { messages } = JSON.parse(prompt.slice(start + separator.length))
  if (!Array.isArray(messages) || !messages.length || messages.length % 2 !== 1) {
    throw new Error('Chat transcript requires completed pairs followed by latest user message')
  }
  for (const [index, message] of messages.entries()) {
    if (message.role !== (index % 2 ? 'assistant' : 'user') || !message.text?.trim()) {
      throw new Error('Invalid Chat role order or text')
    }
    if (message.role === 'assistant' && message.text !== chatResponse((index + 1) / 2)) {
      throw new Error('Chat did not replay deterministic assistant response')
    }
  }
  return { messages, response: chatResponse((messages.length + 1) / 2), argv }
}

export function executeMarker(path) {
  // A separate process performs the tool side effect, never the protocol fixture itself.
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    'import {writeFileSync} from "node:fs"; writeFileSync(process.argv[1], JSON.stringify({pid:process.pid,parent:process.ppid})+"\\n", {flag:"wx"})', path],
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
export const record = (directory, name, value) => writeFileSync(join(directory, name),
  `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
