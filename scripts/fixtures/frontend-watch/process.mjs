import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'

const config = JSON.parse(readFileSync('fixture.json', 'utf8'))
const role = process.argv.includes('tsconfig.node.json') ? 'config' : process.argv.includes('tsconfig.json') ? 'ui' : 'vite'
const behavior = config[role] ?? 'wait'
appendFileSync('pids.jsonl', `${JSON.stringify({ role, pid: process.pid, args: process.argv.slice(2) })}\n`)
if (behavior === 'grandchild') {
  spawn('/bin/sh', ['-c', `
    trap '' TERM
    printf '{"role":"native","pid":%s}\\n' "$$" >> pids.jsonl
    while :; do sleep 1; done
  `], { stdio: 'inherit' })
}
if (behavior === 'stubborn') process.on('SIGTERM', () => {})
if (role === 'vite') {
  const server = createServer((socket) => socket.end('fixture listener'))
  server.on('error', (error) => { console.error(error.message); process.exit(1) })
  server.listen(config.port, '127.0.0.1', () => writeFileSync('listening', String(config.port)))
}
if (behavior === 'zero') setTimeout(() => process.exit(0), 150)
if (behavior === 'nonzero') setTimeout(() => process.exit(7), 150)
if (behavior === 'signal') setTimeout(() => process.kill(process.pid, 'SIGUSR2'), 150)
setInterval(() => {}, 1000)
