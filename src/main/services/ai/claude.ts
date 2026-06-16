import type { AiModelDescriptor, AiProviderStatus, ProviderCapabilities, ReasoningEffort } from '../../../shared/contracts'
import type { CommandRunner } from './commandRunner'
import { commandTimeoutMs, isMissingCommand, providerRuntimeDir, summarizeFailure } from './commandRunner'
import { assertCommandSucceeded, parseJson, parseJsonValues, parseStructuredCliOutput } from './structuredOutput'
import type { StructuredGenerationRequest } from '../aiProviders'
import {
  available,
  capabilitiesFromReasoningEfforts,
  defaultProviderModels,
  isReasoningEffort,
  modelDescriptorsFromModels,
  providerMetadata,
  providerPresetModels,
  reasoningEffortFromCapabilities,
  reasoningEffortsFromCapabilities,
  reasoningEffortValues,
  stringValue,
  unavailable
} from './capabilities'

export async function detectClaudeCode(runner: CommandRunner): Promise<AiProviderStatus> {
  const cwd = providerRuntimeDir('claude')
  const status = await runner('claude', ['auth', 'status', '--json'], { cwd, timeoutMs: 10_000 })
  if (isMissingCommand(status)) {
    return unavailable('claude_code', 'claude was not found on PATH.')
  }
  if (status.code !== 0) {
    return unavailable('claude_code', summarizeFailure('claude auth status --json failed.', status))
  }

  const parsed = parseJson(status.stdout)
  if (
    parsed &&
    typeof parsed === 'object' &&
    (('loggedIn' in parsed && parsed.loggedIn === false) || ('authenticated' in parsed && parsed.authenticated === false))
  ) {
    return unavailable('claude_code', 'claude is installed but is not authenticated.')
  }

  return available('claude_code', await discoverClaudeMetadata(runner, cwd))
}

export async function runClaudeGeneration(
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
    '--disallowedTools',
    'mcp__*',
    '--strict-mcp-config',
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

async function discoverClaudeMetadata(runner: CommandRunner, cwd: string) {
  const fallback = providerMetadata('claude_code')
  const help = await runner('claude', ['--help'], { cwd, timeoutMs: 10_000 })
  const helpMetadata = help.code === 0 ? parseClaudeHelpMetadata(help.stdout) : { models: [], reasoningEfforts: [] }
  const capabilities = helpMetadata.reasoningEfforts.length > 0
    ? capabilitiesFromReasoningEfforts(helpMetadata.reasoningEfforts, defaultReasoningEffortFrom(helpMetadata.reasoningEfforts, fallback.defaultReasoningEffort))
    : fallback.capabilities
  const antModels = await discoverAnthropicModels(runner, cwd, capabilities, fallback.defaultReasoningEffort)

  if (helpMetadata.models.length === 0 && antModels.length === 0 && capabilities === fallback.capabilities) return fallback

  const defaultModel = process.env.CLAUDE_MODEL || fallback.defaultModel || defaultProviderModels.claude_code
  const models = [
    defaultModel,
    ...helpMetadata.models,
    ...antModels.map((model) => model.id),
    ...fallback.models
  ].filter((model, index, values) => values.indexOf(model) === index)
  const fallbackDescriptors = new Map(modelDescriptorsFromModels(fallback.models, capabilities).map((descriptor) => [descriptor.id, descriptor]))
  const discoveredDescriptors = new Map(antModels.map((descriptor) => [descriptor.id, descriptor]))
  const modelDescriptors = models.map((model) => discoveredDescriptors.get(model) ?? fallbackDescriptors.get(model) ?? {
    id: model,
    label: model,
    capabilities
  })
  const defaultCapabilities = modelDescriptors.find((descriptor) => descriptor.id === defaultModel)?.capabilities ?? capabilities

  return {
    ...fallback,
    models,
    modelDescriptors,
    defaultModel,
    reasoningEfforts: reasoningEffortsFromCapabilities(defaultCapabilities),
    defaultReasoningEffort: reasoningEffortFromCapabilities(defaultCapabilities),
    capabilities: defaultCapabilities
  }
}

async function discoverAnthropicModels(
  runner: CommandRunner,
  cwd: string,
  fallbackCapabilities: ProviderCapabilities,
  fallbackDefaultReasoningEffort: ReasoningEffort | null
): Promise<AiModelDescriptor[]> {
  const result = await runner('ant', ['beta:models', 'list'], { cwd, timeoutMs: 10_000 })
  if (result.code !== 0) return []
  return parseAnthropicModelList(result.stdout, fallbackCapabilities, fallbackDefaultReasoningEffort)
}

function parseClaudeHelpMetadata(stdout: string): { models: string[]; reasoningEfforts: ReasoningEffort[] } {
  const modelAliases = providerPresetModels.claude_code.filter((model) => /^[a-z]+$/.test(model))
  const modelSection = sectionAround(stdout, '--model')
  const effortSection = sectionAround(stdout, '--effort')
  const models = modelAliases.filter((model) => new RegExp(`\\b${model}\\b`, 'i').test(modelSection))
  const reasoningEfforts = reasoningEffortValues.filter((effort) => new RegExp(`\\b${effort}\\b`, 'i').test(effortSection))
  return { models, reasoningEfforts }
}

function sectionAround(stdout: string, marker: string): string {
  const index = stdout.indexOf(marker)
  if (index < 0) return ''
  return stdout.slice(index, index + 500)
}

function parseAnthropicModelList(
  stdout: string,
  fallbackCapabilities: ProviderCapabilities,
  fallbackDefaultReasoningEffort: ReasoningEffort | null
): AiModelDescriptor[] {
  const values = parseJsonValues(stdout)
  const records = values.flatMap((value) => anthropicModelRecords(value))
  const descriptors = records.flatMap((record) => {
    const id = stringValue(record.id) ?? stringValue(record.model) ?? stringValue(record.name)
    if (!id) return []
    const label = stringValue(record.display_name) ?? stringValue(record.displayName) ?? stringValue(record.name) ?? id
    const efforts = parseAnthropicReasoningEfforts(record)
    const defaultReasoningEffort = parseAnthropicDefaultReasoningEffort(record, efforts, fallbackDefaultReasoningEffort)
    return [
      {
        id,
        label,
        capabilities: efforts.length > 0
          ? capabilitiesFromReasoningEfforts(efforts, defaultReasoningEffort)
          : fallbackCapabilities
      }
    ]
  })

  return descriptors.filter((descriptor, index) => descriptors.findIndex((candidate) => candidate.id === descriptor.id) === index)
}

function anthropicModelRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => recordValues(item))
  const record = recordValue(value)
  if (!record) return []
  for (const key of ['data', 'models', 'items']) {
    const nested = record[key]
    if (Array.isArray(nested)) return nested.flatMap((item) => recordValues(item))
  }
  return [record]
}

function recordValues(value: unknown): Record<string, unknown>[] {
  const record = recordValue(value)
  return record ? [record] : []
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function parseAnthropicReasoningEfforts(record: Record<string, unknown>): ReasoningEffort[] {
  const capabilities = recordValue(record.capabilities)
  const values = [
    record.supportedReasoningEfforts,
    record.supported_reasoning_efforts,
    record.reasoningEfforts,
    record.reasoning_efforts,
    record.efforts,
    record.effort,
    capabilities?.reasoningEfforts,
    capabilities?.reasoning_efforts,
    capabilities?.efforts,
    capabilities?.effort
  ]
  return [...new Set(values.flatMap((value) => reasoningEffortsFromUnknown(value)))]
}

function reasoningEffortsFromUnknown(value: unknown): ReasoningEffort[] {
  if (Array.isArray(value)) return value.flatMap((item) => reasoningEffortsFromUnknown(item))
  if (isReasoningEffort(value)) return [value]
  if (typeof value === 'string') return reasoningEffortValues.filter((effort) => new RegExp(`\\b${effort}\\b`, 'i').test(value))
  const record = recordValue(value)
  if (!record) return []
  const nested = [record.values, record.supportedValues, record.supported_values, record.options, record.reasoningEffort, record.reasoning_effort]
  const keyed = reasoningEffortValues.filter((effort) => record[effort] === true)
  return [...new Set([...nested.flatMap((item) => reasoningEffortsFromUnknown(item)), ...keyed])]
}

function parseAnthropicDefaultReasoningEffort(
  record: Record<string, unknown>,
  efforts: ReasoningEffort[],
  fallbackDefault: ReasoningEffort | null
): ReasoningEffort | null {
  const capabilities = recordValue(record.capabilities)
  const effort = recordValue(record.effort)
  const capabilityEffort = recordValue(capabilities?.effort)
  const candidates = [
    record.defaultReasoningEffort,
    record.default_reasoning_effort,
    record.defaultEffort,
    record.default_effort,
    effort?.defaultReasoningEffort,
    effort?.default_reasoning_effort,
    effort?.defaultEffort,
    effort?.default_effort,
    capabilities?.defaultReasoningEffort,
    capabilities?.default_reasoning_effort,
    capabilities?.defaultEffort,
    capabilities?.default_effort,
    capabilityEffort?.defaultReasoningEffort,
    capabilityEffort?.default_reasoning_effort,
    capabilityEffort?.defaultEffort,
    capabilityEffort?.default_effort
  ]
  const discovered = candidates.find((candidate): candidate is ReasoningEffort => isReasoningEffort(candidate) && efforts.includes(candidate))
  if (discovered) return discovered
  return defaultReasoningEffortFrom(efforts, fallbackDefault)
}

function defaultReasoningEffortFrom(
  efforts: ReasoningEffort[],
  preferred: ReasoningEffort | null
): ReasoningEffort | null {
  if (preferred && efforts.includes(preferred)) return preferred
  return null
}
