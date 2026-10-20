import assert from 'node:assert/strict'

export function assertNativeChecking(scripts) {
  const commands = value => String(value).split('&&').map(command => command.trim().split(/\s+/))
  const expected = ['tsconfig.json', 'tsconfig.node.json'].map(project => ['tsc-rs', '--noEmit', '-p', project])
  assert.deepEqual(commands(scripts.typecheck), expected, 'Both tsconfig.json and tsconfig.node.json must use exact tsc-rs --noEmit project checks without shell bypasses')
  assert.deepEqual(commands(scripts.build), [['bun', 'run', 'typecheck'], ['vite', 'build']], 'Build must run the shared typecheck before Vite without shell bypasses')
}
