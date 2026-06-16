import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiModelDescriptor, AiProviderStatus } from '../../../shared/contracts'
import type { CommandResult, CommandRunner } from './commandRunner'
import { commandEnvironment, commandTimeoutMs, isMissingCommand, providerRuntimeDir, runCommand, summarizeFailure } from './commandRunner'
import { assertCommandSucceeded, parseJson, parseStructuredCliOutput } from './structuredOutput'
import type { StructuredGenerationRequest } from '../aiProviders'
import {
  available,
  capabilitiesFromReasoningEfforts,
  defaultProviderModels,
  isReasoningEffort,
  providerMetadata,
  reasoningEffortFromCapabilities,
  reasoningEffortsFromCapabilities,
  stringValue,
  unavailable
} from './capabilities'

export async function detectCodexCli(runner: CommandRunner): Promise<AiProviderStatus> {
  const cwd = providerRuntimeDir('codex')
  const loginStatus = await runner('codex', ['login', 'status'], { cwd, timeoutMs: 10_000 })
  if (isMissingCommand(loginStatus)) {
    return unavailable('codex_cli', 'codex was not found on PATH.')
  }
  if (loginStatus.code === 0) {
    return available('codex_cli', await discoverCodexMetadata(runner, cwd))
  }

  const doctor = await runner('codex', ['doctor', '--json'], { cwd, timeoutMs: 20_000 })
  if (doctor.code === 0) {
    return available('codex_cli', await discoverCodexMetadata(runner, cwd))
  }

  return unavailable(
    'codex_cli',
    summarizeFailure('codex login status and codex doctor --json did not report an authenticated local CLI.', loginStatus, doctor)
  )
}

export async function runCodexGeneration(
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

async function discoverCodexMetadata(runner: CommandRunner, cwd: string) {
  const fallback = providerMetadata('codex_cli')
  const result = runner === runCommand ? await runCodexModelListSession(cwd) : await runCodexModelListWithRunner(runner, cwd)

  if (result.code !== 0) return fallback

  const discoveredModels = parseCodexModelList(result.stdout)
  if (discoveredModels.length === 0) return fallback

  const discoveredDefault = discoveredModels.find((model) => model.isDefault)?.id ?? discoveredModels[0]?.id
  const defaultModel = process.env.CODEX_MODEL || discoveredDefault || fallback.defaultModel || defaultProviderModels.codex_cli
  const models = [defaultModel, ...discoveredModels.map((model) => model.id).filter((model) => model !== defaultModel)]
  const fallbackDescriptors = new Map(fallback.modelDescriptors.map((descriptor) => [descriptor.id, descriptor]))
  const discoveredDescriptors = new Map(discoveredModels.map((model) => [model.id, model]))
  const modelDescriptors = models.map((model) => discoveredDescriptors.get(model) ?? fallbackDescriptors.get(model) ?? {
    id: model,
    label: model,
    capabilities: fallback.capabilities
  })
  const defaultCapabilities = modelDescriptors.find((descriptor) => descriptor.id === defaultModel)?.capabilities ?? fallback.capabilities
  const defaultReasoning = reasoningEffortFromCapabilities(defaultCapabilities)

  return {
    ...fallback,
    models,
    modelDescriptors,
    defaultModel,
    reasoningEfforts: reasoningEffortsFromCapabilities(defaultCapabilities),
    defaultReasoningEffort: defaultReasoning,
    capabilities: defaultCapabilities
  }
}

async function runCodexModelListWithRunner(runner: CommandRunner, cwd: string): Promise<CommandResult> {
  const input = [
    { method: 'initialize', id: 0, params: { clientInfo: { name: 'qa-scribe', title: 'qa-scribe', version: '0.1.0' } } },
    { method: 'initialized', params: {} },
    { method: 'model/list', id: 1, params: { limit: 100, includeHidden: false } }
  ]
    .map((message) => JSON.stringify(message))
    .join('\n')
  return runner('codex', ['app-server', '--stdio'], {
    cwd,
    input: `${input}\n`,
    timeoutMs: 20_000
  })
}

async function runCodexModelListSession(cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn('codex', ['app-server', '--stdio'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: commandEnvironment()
    })
    let stdout = ''
    let stderr = ''
    let stdoutBuffer = ''
    let settled = false
    const settle = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
      resolve(result)
    }
    const send = (message: unknown) => {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    }
    const timeout = setTimeout(() => {
      settle({ code: null, stdout, stderr: `${stderr}\nCommand timed out`.trim() })
    }, 20_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const message = parseJson(line.trim())
        if (!message || typeof message !== 'object') continue
        const id = (message as { id?: unknown }).id
        if (id === 0) {
          send({ method: 'initialized', params: {} })
          send({ method: 'model/list', id: 1, params: { limit: 100, includeHidden: false } })
        }
        if (id === 1) {
          settle({ code: 0, stdout, stderr })
        }
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      settle({ code: null, stdout, stderr, error })
    })
    child.on('close', (code) => {
      settle({ code, stdout, stderr })
    })

    send({ method: 'initialize', id: 0, params: { clientInfo: { name: 'qa-scribe', title: 'qa-scribe', version: '0.1.0' } } })
  })
}

function parseCodexModelList(stdout: string): Array<AiModelDescriptor & { isDefault: boolean }> {
  const response = stdout
    .split('\n')
    .map((line) => parseJson(line.trim()))
    .find((line) => line && typeof line === 'object' && (line as { id?: unknown }).id === 1) as Record<string, unknown> | undefined
  const result = response?.result
  const data = result && typeof result === 'object' ? (result as { data?: unknown }).data : null
  if (!Array.isArray(data)) return []

  return data.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const id = stringValue(record.id) ?? stringValue(record.model)
    if (!id) return []
    const label = stringValue(record.displayName) ?? id
    const supportedReasoningEfforts = Array.isArray(record.supportedReasoningEfforts)
      ? record.supportedReasoningEfforts
      : []
    const efforts = supportedReasoningEfforts.flatMap((effort) => {
      if (!effort || typeof effort !== 'object') return []
      const value = (effort as { reasoningEffort?: unknown }).reasoningEffort
      return isReasoningEffort(value) ? [value] : []
    })
    const defaultValue = isReasoningEffort(record.defaultReasoningEffort) ? record.defaultReasoningEffort : null
    return [
      {
        id,
        label,
        capabilities: capabilitiesFromReasoningEfforts(efforts, defaultValue),
        isDefault: record.isDefault === true
      }
    ]
  })
}
