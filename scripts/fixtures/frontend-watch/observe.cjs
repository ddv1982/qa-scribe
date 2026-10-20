const cp = require('node:child_process')
const { appendFileSync } = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')

if (process.argv[1]?.endsWith('/scripts/run-frontend-dev.mjs')) {
  const spawn = cp.spawn
  cp.spawn = function (executable, args, options) {
    const child = spawn(executable, args, options)
    if (typeof child.pid === 'number') {
      appendFileSync(`${options.cwd}/groups.jsonl`, `${JSON.stringify({ pid: child.pid })}\n`)
    }
    return child
  }
  syncBuiltinESMExports()
}
