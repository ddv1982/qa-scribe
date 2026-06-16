import type { CommandResult } from './commandRunner'
import { isMissingCommand } from './commandRunner'

export function parseStructuredCliOutput(stdout: string): unknown {
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

export function parseJson(value: string): any | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function parseJsonValues(stdout: string): unknown[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  const parsed = parseJson(trimmed)
  if (parsed !== null) return [parsed]
  return trimmed.split('\n').flatMap((line) => {
    const value = parseJson(line.trim())
    return value === null ? [] : [value]
  })
}

export function assertCommandSucceeded(label: string, result: CommandResult): void {
  if (result.code === 0) return
  if (isMissingCommand(result)) throw new Error(`${label} failed because the command was not found on PATH.`)
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? 'unknown'}`
  throw new Error(`${label} failed: ${detail}`)
}
