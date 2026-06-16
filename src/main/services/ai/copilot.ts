import type { AiProviderStatus } from '../../../shared/contracts'
import type { CommandRunner } from './commandRunner'
import { commandTimeoutMs, isMissingCommand, providerRuntimeDir, summarizeFailure } from './commandRunner'
import { assertCommandSucceeded, parseStructuredCliOutput } from './structuredOutput'
import type { StructuredGenerationRequest } from '../aiProviders'
import {
  available,
  copilotCapabilitiesForModel,
  defaultProviderModels,
  providerMetadata,
  reasoningEffortFromCapabilities,
  reasoningEffortsFromCapabilities,
  unavailable
} from './capabilities'

export async function detectCopilotCli(runner: CommandRunner): Promise<AiProviderStatus> {
  const cwd = providerRuntimeDir('copilot')
  const status = await runner('copilot', ['version'], { cwd, timeoutMs: 10_000 })
  if (isMissingCommand(status)) {
    return unavailable('copilot_cli', 'copilot was not found on PATH.')
  }
  if (status.code === 0) {
    return available('copilot_cli', await discoverCopilotMetadata(runner, cwd))
  }

  return unavailable('copilot_cli', summarizeFailure('copilot version failed.', status))
}

export async function runCopilotGeneration(
  request: StructuredGenerationRequest,
  runner: CommandRunner
): Promise<unknown> {
  const runtimeDir = providerRuntimeDir('copilot')
  const prompt = `${request.prompt}\n\nReturn only a JSON value that matches this JSON Schema. Do not include Markdown fences, comments, explanations, or any text outside the JSON value.\n\nJSON Schema:\n${JSON.stringify(request.outputSchema)}`
  const args = ['-p', prompt, '-s', '--no-ask-user', '--model', request.model]
  if (request.reasoningEffort) args.push('--effort', request.reasoningEffort)
  const result = await runner('copilot', args, {
    cwd: runtimeDir,
    timeoutMs: commandTimeoutMs
  })
  assertCommandSucceeded('copilot -p', result)
  return parseStructuredCliOutput(result.stdout)
}

async function discoverCopilotMetadata(runner: CommandRunner, cwd: string) {
  const fallback = providerMetadata('copilot_cli')
  const result = await runner('copilot', ['help', 'config'], { cwd, timeoutMs: 10_000 })
  if (result.code !== 0) return fallback

  const discoveredModels = parseCopilotConfigModels(result.stdout)
  if (discoveredModels.length === 0) return fallback

  const defaultModel = process.env.COPILOT_MODEL || fallback.defaultModel || defaultProviderModels.copilot_cli
  const models = [defaultModel, ...discoveredModels.filter((model) => model !== defaultModel)]
  const fallbackDescriptors = new Map(fallback.modelDescriptors.map((descriptor) => [descriptor.id, descriptor]))
  const modelDescriptors = models.map((model) => model === 'auto' ? fallbackDescriptors.get(model) ?? {
    id: model,
    label: model,
    capabilities: { optionDescriptors: [] }
  } : {
    id: model,
    label: model,
    capabilities: copilotCapabilitiesForModel(model)
  })
  const defaultCapabilities = modelDescriptors.find((descriptor) => descriptor.id === defaultModel)?.capabilities ?? fallback.capabilities

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

function parseCopilotConfigModels(stdout: string): string[] {
  const modelSectionStart = stdout.indexOf('`model`:')
  if (modelSectionStart < 0) return []
  const contextSectionStart = stdout.indexOf('`contextTier`:', modelSectionStart)
  const modelSection = stdout.slice(modelSectionStart, contextSectionStart > modelSectionStart ? contextSectionStart : undefined)
  const models = [...modelSection.matchAll(/- "([^"]+)"/g)].map((match) => match[1]).filter(Boolean)
  return [...new Set(models)]
}
