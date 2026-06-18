import type { AiProviderId, AiProviderStatus, ProviderSettings, ReasoningEffort } from '../../shared/contracts'
import { detectClaudeCode, runClaudeGeneration } from './ai/claude'
import { detectCodexCli, runCodexGeneration } from './ai/codex'
import { detectCopilotCli, runCopilotGeneration } from './ai/copilot'
import {
  commandEnvironment,
  mergePaths,
  resolveLoginShell,
  runCommand,
  type CommandResult,
  type CommandRunner
} from './ai/commandRunner'
import { defaultProviderModels, providerMetadata, unavailable } from './ai/capabilities'
import { parseStructuredCliOutput } from './ai/structuredOutput'

export type { CommandResult, CommandRunner }

export type StructuredGenerationRequest = {
  provider: AiProviderId
  model: string
  reasoningEffort: ReasoningEffort | null
  prompt: string
  outputSchema: unknown
}

export { defaultProviderModels }

const providerDetectors: Record<AiProviderId, (runner: CommandRunner) => Promise<AiProviderStatus>> = {
  claude_code: detectClaudeCode,
  codex_cli: detectCodexCli,
  copilot_cli: detectCopilotCli
}

const providerOrder: AiProviderId[] = ['claude_code', 'codex_cli', 'copilot_cli']

export async function detectProviderStatuses(
  runner: CommandRunner = runCommand,
  enabledProviders?: ProviderSettings
): Promise<AiProviderStatus[]> {
  const providers = await Promise.all(
    providerOrder.map((provider) => {
      if (enabledProviders?.[provider] === false) return Promise.resolve(disabledProviderStatus(provider))
      return providerDetectors[provider](runner)
    })
  )

  return providers
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

  if (request.provider === 'copilot_cli') {
    return runCopilotGeneration(request, runner)
  }

  throw new Error('Unsupported AI provider. Choose an available local provider instead.')
}

export const __testables = {
  parseStructuredCliOutput,
  commandEnvironment,
  mergePaths,
  resolveLoginShell
}

function disabledProviderStatus(provider: AiProviderId): AiProviderStatus {
  const metadata = providerMetadata(provider)
  return unavailable(provider, `${metadata.label} is disabled in Settings.`)
}
