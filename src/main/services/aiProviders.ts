import type { AiProviderId, AiProviderStatus, ReasoningEffort } from '../../shared/contracts'
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
import { defaultProviderModels } from './ai/capabilities'
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

export async function detectProviderStatuses(runner: CommandRunner = runCommand): Promise<AiProviderStatus[]> {
  const [claude, codex, copilot] = await Promise.all([
    detectClaudeCode(runner),
    detectCodexCli(runner),
    detectCopilotCli(runner)
  ])

  return [
    claude,
    codex,
    copilot
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
