import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const fixture = fileURLToPath(new URL('../src-tauri/src/commands/ai/chat_duplex/fixture.py', import.meta.url))

test('busy peers retain the minimum notification count with coarse scheduler sleeps', () => {
  const observations = JSON.parse(execFileSync('python3', ['-c', `
import ast,io,json,sys,types
source = ast.parse(open(sys.argv[1]).read())
function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'busy_progress')
code = compile(ast.Module(body=[function], type_ignores=[]), sys.argv[1], 'exec')
observations = []
for provider in ['claude', 'codex', 'copilot']:
    now, records, stdout = [0.0], [], io.StringIO()
    def sleep(delay):
        now[0] += max(delay, 0.02)
    context = {'provider': provider, 'json': json, 'record': records.append,
        'time': types.SimpleNamespace(monotonic=lambda: now[0], sleep=sleep),
        'sys': types.SimpleNamespace(stdout=stdout)}
    exec(code, context)
    context['busy_progress']()
    frames = [json.loads(line) for line in stdout.getvalue().splitlines()]
    observations.append({'provider': provider, 'record': records[0], 'frames': frames,
        'bytes': len(stdout.getvalue().encode())})
print(json.dumps(observations))
`, fixture], { encoding: 'utf8', timeout: 5_000 }))

  assert.deepEqual(observations.map(value => value.provider), ['claude', 'codex', 'copilot'])
  for (const { provider, record, frames, bytes } of observations) {
    assert.ok(frames.length >= 100, `${provider}: the fixture must produce at least 100 valid frames`)
    assert.equal(record.busy_frames, frames.length)
    assert.ok(record.busy_seconds >= 1)
    assert.ok(bytes < 1024 * 1024)
    for (const frame of frames) {
      assert.equal(provider === 'claude' ? frame.type : frame.method,
        { claude: 'tool_progress', codex: 'item/started', copilot: 'session/update' }[provider])
    }
  }
})
