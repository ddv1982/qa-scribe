const cp = require('node:child_process')
const fs = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')
const { EventEmitter } = require('node:events')

const spawn = cp.spawn
const kill = process.kill
let configGroup
let configFault
let configFrontend
let retired = false
process.kill = function (pid, signal) {
  if (pid === configGroup) {
    if (configFault === 'kill-error' && signal === 'SIGTERM') throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
    if (configFault === 'survive') return true
    if (configFault === 'esrch-reuse' && retired) {
      fs.appendFileSync(`${configFrontend}/retired-group-signaled`, `${signal}\n`)
      return true
    }
  }
  try { return kill(pid, signal) } catch (error) {
    if (pid === configGroup && error.code === 'ESRCH') retired = true
    throw error
  }
}
cp.spawn = function (executable, args, options) {
  const fault = JSON.parse(fs.readFileSync(`${options.cwd}/fixture.json`, 'utf8')).fault
  if (!args.includes('tsconfig.node.json')) return spawn(executable, args, options)
  const deadline = Date.now() + 4000
  while (!fs.existsSync(`${options.cwd}/pids.jsonl`) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
  }
  if (fault === 'startup') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  if (fault === 'throw') throw Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' })
  if (fault === 'enoent') return spawn(`${options.cwd}/missing-node`, args, options)
  if (fault === 'no-close') {
    const child = new EventEmitter()
    child.unref = () => {}
    process.nextTick(() => child.emit('error', Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' })))
    return child
  }
  const child = spawn(executable, args, options)
  configGroup = -child.pid
  configFault = fault
  configFrontend = options.cwd
  return child
}
syncBuiltinESMExports()
