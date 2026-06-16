import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'

export type CommandResult = {
  code: number | null
  stdout: string
  stderr: string
  error?: NodeJS.ErrnoException
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd?: string
    input?: string
    timeoutMs?: number
  }
) => Promise<CommandResult>

export const commandTimeoutMs = 10 * 60 * 1000

const shellPathTimeoutMs = 5_000
let commandPath: string | null | undefined

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; timeoutMs?: number } = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: commandEnvironment()
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      resolve({ code: null, stdout, stderr: `${stderr}\nCommand timed out`.trim() })
    }, options.timeoutMs ?? commandTimeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ code: null, stdout, stderr, error })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ code, stdout, stderr })
    })

    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

export function assertCommandSucceeded(label: string, result: CommandResult): void {
  if (result.code === 0) return
  if (isMissingCommand(result)) throw new Error(`${label} failed because the command was not found on PATH.`)
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? 'unknown'}`
  throw new Error(`${label} failed: ${detail}`)
}

export function summarizeFailure(prefix: string, ...results: CommandResult[]): string {
  const detail = results
    .map((result) => result.stderr.trim() || result.stdout.trim())
    .filter(Boolean)
    .join(' ')
  return detail ? `${prefix} ${detail}` : prefix
}

export function isMissingCommand(result: CommandResult): boolean {
  return result.error?.code === 'ENOENT'
}

export function providerRuntimeDir(provider: 'claude' | 'codex' | 'copilot'): string {
  const root = process.env.QA_SCRIBE_PROVIDER_RUNTIME_DIR || join(homedir(), '.qa-scribe', 'provider-runtime')
  const dir = join(root, provider)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function commandEnvironment(): NodeJS.ProcessEnv {
  const path = providerCommandPath()
  return path ? { ...process.env, PATH: path } : process.env
}

function providerCommandPath(): string | undefined {
  if (commandPath !== undefined) return commandPath ?? undefined

  const paths = [readLoginShellPath(), process.env.PATH, fallbackProviderPath()].filter(Boolean) as string[]
  commandPath = mergePaths(paths)
  return commandPath ?? undefined
}

function readLoginShellPath(): string | null {
  const shell = resolveLoginShell()
  if (!shell) return null

  try {
    const path = execFileSync(shell, ['-ilc', 'printf %s "$PATH"'], {
      encoding: 'utf8',
      env: process.env,
      timeout: shellPathTimeoutMs
    }).trim()
    return path || null
  } catch {
    return null
  }
}

export function resolveLoginShell(): string | null {
  if (process.platform === 'win32') return null
  if (process.env.SHELL?.trim()) return process.env.SHELL.trim()

  try {
    const shell = userInfo().shell?.trim()
    if (shell) return shell
  } catch {
    // Ignore unavailable user info and fall back below.
  }

  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

function fallbackProviderPath(): string | null {
  if (process.platform === 'win32') return null
  const commonPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  return commonPaths.join(delimiter)
}

export function mergePaths(paths: string[]): string | null {
  const parts = paths.flatMap((path) => path.split(delimiter).map((part) => part.trim()).filter(Boolean))
  const unique = [...new Set(parts)]
  return unique.length > 0 ? unique.join(delimiter) : null
}
