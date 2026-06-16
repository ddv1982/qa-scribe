import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import type { AiProviderId, AiProviderStatus, ReasoningEffort } from '../../shared/contracts'

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

export type StructuredGenerationRequest = {
  provider: AiProviderId
  model: string
  reasoningEffort: ReasoningEffort | null
  prompt: string
  outputSchema: unknown
}

export const defaultProviderModels: Record<AiProviderId, string> = {
  apple_intelligence: 'system-language-model',
  claude_code: process.env.CLAUDE_MODEL || 'sonnet',
  codex_cli: process.env.CODEX_MODEL || 'gpt-5.5',
  openai_legacy: process.env.OPENAI_MODEL || 'gpt-4.1-mini'
}

const providerPresetModels: Record<AiProviderId, string[]> = {
  apple_intelligence: ['system-language-model'],
  claude_code: ['sonnet', 'opus'],
  codex_cli: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
  openai_legacy: [defaultProviderModels.openai_legacy]
}

const providerReasoningEfforts: Record<AiProviderId, ReasoningEffort[]> = {
  apple_intelligence: [],
  claude_code: ['low', 'medium', 'high'],
  codex_cli: ['low', 'medium', 'high', 'xhigh'],
  openai_legacy: []
}

const defaultReasoningEfforts: Record<AiProviderId, ReasoningEffort | null> = {
  apple_intelligence: null,
  claude_code: 'medium',
  codex_cli: 'high',
  openai_legacy: null
}

const commandTimeoutMs = 10 * 60 * 1000
const shellPathTimeoutMs = 5_000
let commandPath: string | null | undefined

type AppleIntelligenceBridge = {
  isAvailable?: () => boolean | Promise<boolean>
  generateStructuredOutput?: (request: {
    model: string
    prompt: string
    outputSchema: unknown
  }) => Promise<unknown>
}

export async function detectProviderStatuses(runner: CommandRunner = runCommand): Promise<AiProviderStatus[]> {
  const [apple, claude, codex] = await Promise.all([
    detectAppleIntelligence(runner),
    detectClaudeCode(runner),
    detectCodexCli(runner)
  ])

  return [
    apple,
    claude,
    codex,
    unavailable('openai_legacy', 'Legacy OpenAI API-key generation is not used by this build.')
  ]
}

export async function generateStructuredOutput(
  request: StructuredGenerationRequest,
  runner: CommandRunner = runCommand
): Promise<unknown> {
  if (request.provider === 'codex_cli') {
    return runCodexGeneration(request, runner)
  }

  if (request.provider === 'claude_code') {
    return runClaudeGeneration(request, runner)
  }

  if (request.provider === 'apple_intelligence') {
    return runAppleGeneration(request, runner)
  }

  throw new Error('Legacy OpenAI API-key generation is not available. Choose a local provider instead.')
}

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

async function detectCodexCli(runner: CommandRunner): Promise<AiProviderStatus> {
  const cwd = providerRuntimeDir('codex')
  const loginStatus = await runner('codex', ['login', 'status'], { cwd, timeoutMs: 10_000 })
  if (isMissingCommand(loginStatus)) {
    return unavailable('codex_cli', 'codex was not found on PATH.')
  }
  if (loginStatus.code === 0) {
    return available('codex_cli')
  }

  const doctor = await runner('codex', ['doctor', '--json'], { cwd, timeoutMs: 20_000 })
  if (doctor.code === 0) {
    return available('codex_cli')
  }

  return unavailable(
    'codex_cli',
    summarizeFailure('codex login status and codex doctor --json did not report an authenticated local CLI.', loginStatus, doctor)
  )
}

async function detectClaudeCode(runner: CommandRunner): Promise<AiProviderStatus> {
  const status = await runner('claude', ['auth', 'status', '--json'], { cwd: providerRuntimeDir('claude'), timeoutMs: 10_000 })
  if (isMissingCommand(status)) {
    return unavailable('claude_code', 'claude was not found on PATH.')
  }
  if (status.code !== 0) {
    return unavailable('claude_code', summarizeFailure('claude auth status --json failed.', status))
  }

  const parsed = parseJson(status.stdout)
  if (parsed && typeof parsed === 'object' && 'authenticated' in parsed && parsed.authenticated === false) {
    return unavailable('claude_code', 'claude is installed but is not authenticated.')
  }

  return available('claude_code')
}

async function detectAppleIntelligence(runner: CommandRunner): Promise<AiProviderStatus> {
  const bridge = getAppleBridge()
  if (bridge?.generateStructuredOutput) {
    const isAvailable = bridge.isAvailable ? await bridge.isAvailable() : true
    if (!isAvailable) {
      return unavailable('apple_intelligence', 'Apple Intelligence native helper bridge reported unavailable.')
    }
    return available('apple_intelligence')
  }

  const helperPath = appleHelperPath()
  if (!helperPath) {
    return unavailable('apple_intelligence', 'Apple Intelligence native helper is not bundled or configured.')
  }

  const status = await runner(helperPath, ['status', '--json'], { timeoutMs: 10_000 })
  if (status.code !== 0) {
    return unavailable('apple_intelligence', summarizeFailure('Apple Intelligence native helper status check failed.', status))
  }

  const parsed = parseJson(status.stdout)
  if (parsed && typeof parsed === 'object' && 'available' in parsed && parsed.available === false) {
    const reason =
      'reason' in parsed && typeof parsed.reason === 'string'
        ? parsed.reason
        : 'Apple Intelligence native helper reported unavailable.'
    return unavailable('apple_intelligence', reason)
  }

  return available('apple_intelligence')
}

async function runCodexGeneration(
  request: StructuredGenerationRequest,
  runner: CommandRunner
): Promise<unknown> {
  const tempDir = mkdtempSync(join(tmpdir(), 'qa-scribe-codex-'))
  try {
    const runtimeDir = providerRuntimeDir('codex')
    const schemaPath = join(tempDir, 'schema.json')
    writeFileSync(schemaPath, JSON.stringify(request.outputSchema), 'utf8')
    const result = await runner(
      'codex',
      [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-c',
        'approval_policy="never"',
        '--model',
        request.model,
        '-c',
        `model_reasoning_effort="${request.reasoningEffort ?? 'medium'}"`,
        '--output-schema',
        schemaPath
      ],
      {
        cwd: runtimeDir,
        input: request.prompt,
        timeoutMs: commandTimeoutMs
      }
    )
    assertCommandSucceeded('codex exec', result)
    return parseStructuredCliOutput(result.stdout)
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
}

async function runClaudeGeneration(
  request: StructuredGenerationRequest,
  runner: CommandRunner
): Promise<unknown> {
  const runtimeDir = providerRuntimeDir('claude')
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(request.outputSchema),
    '--no-session-persistence',
    '--tools',
    '',
    '--model',
    request.model
  ]
  if (request.reasoningEffort) {
    args.push('--effort', request.reasoningEffort)
  }

  const result = await runner('claude', args, {
    cwd: runtimeDir,
    input: request.prompt,
    timeoutMs: commandTimeoutMs
  })
  assertCommandSucceeded('claude -p', result)
  return parseStructuredCliOutput(result.stdout)
}

async function runAppleGeneration(request: StructuredGenerationRequest, runner: CommandRunner): Promise<unknown> {
  const bridge = getAppleBridge()
  if (!bridge?.generateStructuredOutput) {
    return runAppleHelperGeneration(request, runner)
  }

  return bridge.generateStructuredOutput({
    model: request.model,
    prompt: request.prompt,
    outputSchema: request.outputSchema
  })
}

async function runAppleHelperGeneration(request: StructuredGenerationRequest, runner: CommandRunner): Promise<unknown> {
  const helperPath = appleHelperPath()
  if (!helperPath) {
    throw new Error('Apple Intelligence native helper is not bundled or configured.')
  }

  const result = await runner(helperPath, ['generate', '--json'], {
    input: JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      outputSchema: request.outputSchema
    }),
    timeoutMs: commandTimeoutMs
  })
  assertCommandSucceeded('Apple Intelligence native helper', result)
  return parseStructuredCliOutput(result.stdout)
}

function parseStructuredCliOutput(stdout: string): unknown {
  const parsed = parseJson(stdout.trim())
  if (parsed === null) {
    throw new Error('AI provider returned non-JSON output.')
  }

  for (const candidate of outputCandidates(parsed)) {
    const value = typeof candidate === 'string' ? parseJson(candidate.trim()) : candidate
    if (value !== null) return value
  }

  throw new Error('AI provider JSON output did not contain a structured result.')
}

function outputCandidates(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [value]
  const record = value as Record<string, unknown>
  return [
    record.result,
    record.structured_output,
    record.output,
    record.response,
    record.content,
    textFromContent(record.content),
    value
  ].filter((candidate) => candidate !== undefined)
}

function textFromContent(content: unknown): unknown {
  if (!Array.isArray(content)) return undefined
  const textItem = content.find((item) => typeof item === 'object' && item !== null && 'text' in item)
  return textItem && typeof textItem === 'object' ? (textItem as { text?: unknown }).text : undefined
}

function parseJson(value: string): any | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function assertCommandSucceeded(label: string, result: CommandResult): void {
  if (result.code === 0) return
  if (isMissingCommand(result)) throw new Error(`${label} failed because the command was not found on PATH.`)
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? 'unknown'}`
  throw new Error(`${label} failed: ${detail}`)
}

function summarizeFailure(prefix: string, ...results: CommandResult[]): string {
  const detail = results
    .map((result) => result.stderr.trim() || result.stdout.trim())
    .filter(Boolean)
    .join(' ')
  return detail ? `${prefix} ${detail}` : prefix
}

function available(provider: AiProviderId): AiProviderStatus {
  const metadata = providerMetadata(provider)
  return {
    provider,
    label: metadata.label,
    available: true,
    reason: null,
    models: metadata.models,
    defaultModel: metadata.defaultModel,
    reasoningEfforts: metadata.reasoningEfforts,
    defaultReasoningEffort: metadata.defaultReasoningEffort,
    localOnly: metadata.localOnly,
    requiresNetwork: metadata.requiresNetwork
  }
}

function unavailable(provider: AiProviderId, reason: string): AiProviderStatus {
  const metadata = providerMetadata(provider)
  return {
    provider,
    label: metadata.label,
    available: false,
    reason,
    models: metadata.models,
    defaultModel: metadata.defaultModel,
    reasoningEfforts: metadata.reasoningEfforts,
    defaultReasoningEffort: metadata.defaultReasoningEffort,
    localOnly: metadata.localOnly,
    requiresNetwork: metadata.requiresNetwork
  }
}

function providerMetadata(provider: AiProviderId): Omit<AiProviderStatus, 'provider' | 'available' | 'reason'> {
  const defaultModel = defaultProviderModels[provider]
  const presetModels = providerPresetModels[provider]
  const models = [defaultModel, ...presetModels.filter((model) => model !== defaultModel)]
  return {
    label: providerLabel(provider),
    models,
    defaultModel,
    reasoningEfforts: providerReasoningEfforts[provider],
    defaultReasoningEffort: defaultReasoningEfforts[provider],
    localOnly: provider !== 'openai_legacy',
    requiresNetwork: provider === 'claude_code' || provider === 'codex_cli' || provider === 'openai_legacy'
  }
}

function providerLabel(provider: AiProviderId): string {
  if (provider === 'apple_intelligence') return 'Apple Intelligence'
  if (provider === 'claude_code') return 'Claude Code'
  if (provider === 'codex_cli') return 'Codex CLI'
  return 'OpenAI Legacy'
}

function isMissingCommand(result: CommandResult): boolean {
  return result.error?.code === 'ENOENT'
}

function providerRuntimeDir(provider: 'claude' | 'codex'): string {
  const root = process.env.QA_SCRIBE_PROVIDER_RUNTIME_DIR || join(homedir(), '.qa-scribe', 'provider-runtime')
  const dir = join(root, provider)
  mkdirSync(dir, { recursive: true })
  return dir
}

function commandEnvironment(): NodeJS.ProcessEnv {
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

function resolveLoginShell(): string | null {
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

function mergePaths(paths: string[]): string | null {
  const parts = paths.flatMap((path) => path.split(delimiter).map((part) => part.trim()).filter(Boolean))
  const unique = [...new Set(parts)]
  return unique.length > 0 ? unique.join(delimiter) : null
}

function getAppleBridge(): AppleIntelligenceBridge | undefined {
  return (globalThis as { qaScribeAppleIntelligence?: AppleIntelligenceBridge }).qaScribeAppleIntelligence
}

function appleHelperPath(): string | null {
  if (process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER) return process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER
  const resourcesPath = process.resourcesPath
  if (!resourcesPath) return null

  const candidate = join(resourcesPath, 'qa-scribe-apple-intelligence-helper')
  return existsSync(candidate) ? candidate : null
}

export const __testables = {
  parseStructuredCliOutput,
  commandEnvironment,
  mergePaths,
  resolveLoginShell
}
