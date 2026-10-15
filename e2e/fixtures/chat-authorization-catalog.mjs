import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

export function catalogObservation(provider, method) {
  const directory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
  if (directory && process.env.QA_SCRIBE_E2E_AUTH_PROVIDER) {
    appendFileSync(join(directory, 'authorization-catalog.jsonl'), `${JSON.stringify({ provider, method })}\n`)
  }
}

export function copilotCatalog() {
  let buffered = Buffer.alloc(0)
  process.stdin.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk])
    for (;;) {
      const separator = buffered.indexOf('\r\n\r\n')
      if (separator < 0) return
      const length = Number(buffered.subarray(0, separator).toString().match(/Content-Length:\s*(\d+)/i)?.[1])
      if (!Number.isInteger(length) || length < 0) throw new Error('Invalid catalog frame')
      if (buffered.length < separator + 4 + length) return
      const request = JSON.parse(buffered.subarray(separator + 4, separator + 4 + length).toString())
      buffered = buffered.subarray(separator + 4 + length)
      catalogObservation('copilot', request.method)
      let result
      switch (request.method) {
        case 'connect': result = { ok: true, protocolVersion: 3, version: '1.0.70' }; break
        case 'status.get': result = { protocolVersion: 3, version: '1.0.70' }; break
        case 'auth.getStatus': result = { isAuthenticated: true }; break
        case 'models.list': result = { models: [{ id: 'fixture-model', name: 'Fixture model' }] }; break
        case 'runtime.shutdown': result = {}; break
        default: throw new Error(`Catalog must not issue model requests: ${request.method}`)
      }
      const response = JSON.stringify({ jsonrpc: '2.0', id: request.id, result })
      process.stdout.write(`Content-Length: ${Buffer.byteLength(response)}\r\n\r\n${response}`)
    }
  })
}
