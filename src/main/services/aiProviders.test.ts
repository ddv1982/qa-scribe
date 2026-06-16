import { existsSync } from 'node:fs'
import { delimiter } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CommandRunner } from './aiProviders'
import { __testables, detectProviderStatuses, generateStructuredOutput } from './aiProviders'

describe('aiProviders', () => {
  it('runs Claude with schema, model, effort, provider runtime cwd, and prompt over stdin', async () => {
    const calls: Array<{ command: string; args: string[]; input?: string; cwd?: string }> = []
    const runner: CommandRunner = async (command, args, options) => {
      calls.push({ command, args, input: options.input, cwd: options.cwd })
      return {
        code: 0,
        stdout: JSON.stringify({
          type: 'result',
          structured_output: {
            answer: 'ok'
          }
        }),
        stderr: ''
      }
    }

    await expect(
      generateStructuredOutput(
        {
          provider: 'claude_code',
          model: 'claude-sonnet-4',
          reasoningEffort: 'high',
          prompt: 'reviewed generation context',
          outputSchema: { type: 'object' }
        },
        runner
      )
    ).resolves.toEqual({ answer: 'ok' })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(
      expect.objectContaining({
        command: 'claude',
        input: 'reviewed generation context'
      })
    )
    expect(calls[0].cwd).toContain('qa-scribe')
    expect(calls[0].cwd).toContain('provider-runtime')
    expect(calls[0].cwd).toContain('claude')
    expect(calls[0].args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify({ type: 'object' }),
      '--no-session-persistence',
      '--tools',
      '',
      '--model',
      'claude-sonnet-4',
      '--effort',
      'high'
    ])
  })

  it('parses direct JSON CLI output', () => {
    expect(__testables.parseStructuredCliOutput('{"answer":"ok"}')).toEqual({ answer: 'ok' })
  })

  it('hydrates provider command PATH with inherited and common local install paths', () => {
    const env = __testables.commandEnvironment()
    const path = env.PATH ?? ''
    const pathParts = path.split(delimiter)

    for (const part of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
      expect(pathParts).toContain(part)
    }

    if (process.platform !== 'win32') {
      expect(pathParts).toContain('/usr/local/bin')
      expect(pathParts).toContain('/opt/homebrew/bin')
    }
  })

  it('runs Codex with a temp schema file, never-approval config, model, effort, provider runtime cwd, and prompt over stdin', async () => {
    const calls: Array<{ command: string; args: string[]; input?: string; cwd?: string }> = []
    const runner: CommandRunner = async (command, args, options) => {
      calls.push({ command, args, input: options.input, cwd: options.cwd })
      const schemaPath = args[args.indexOf('--output-schema') + 1]
      expect(schemaPath).toBeTruthy()
      expect(existsSync(schemaPath)).toBe(true)
      return {
        code: 0,
        stdout: JSON.stringify({
          answer: 'ok'
        }),
        stderr: ''
      }
    }

    await expect(
      generateStructuredOutput(
        {
          provider: 'codex_cli',
          model: 'gpt-5.5',
          reasoningEffort: 'xhigh',
          prompt: 'reviewed generation context',
          outputSchema: { type: 'object' }
        },
        runner
      )
    ).resolves.toEqual({ answer: 'ok' })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(
      expect.objectContaining({
        command: 'codex',
        input: 'reviewed generation context'
      })
    )
    expect(calls[0].cwd).toContain('qa-scribe')
    expect(calls[0].cwd).toContain('provider-runtime')
    expect(calls[0].cwd).toContain('codex')
    expect(calls[0].args).toEqual(
      expect.arrayContaining([
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-c',
        'approval_policy="never"',
        '--model',
        'gpt-5.5',
        '-c',
        'model_reasoning_effort="xhigh"',
        '--output-schema'
      ])
    )
    expect(calls[0].args).not.toContain('--ask-for-approval')
  })

  it('rejects invalid structured output from CLI adapters', async () => {
    const originalHelper = process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER
    process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER = '/tmp/qa-scribe-apple-helper'
    const runner: CommandRunner = async () => ({
      code: 0,
      stdout: 'not json',
      stderr: ''
    })

    try {
      await expect(
        generateStructuredOutput(
          {
            provider: 'codex_cli',
            model: 'gpt-5.5',
            reasoningEffort: 'high',
            prompt: 'reviewed generation context',
            outputSchema: { type: 'object' }
          },
          runner
        )
      ).rejects.toThrow('AI provider returned non-JSON output.')

      await expect(
        generateStructuredOutput(
          {
            provider: 'claude_code',
            model: 'sonnet',
            reasoningEffort: 'medium',
            prompt: 'reviewed generation context',
            outputSchema: { type: 'object' }
          },
          runner
        )
      ).rejects.toThrow('AI provider returned non-JSON output.')

      await expect(
        generateStructuredOutput(
          {
            provider: 'apple_intelligence',
            model: 'system-language-model',
            reasoningEffort: null,
            prompt: 'reviewed generation context',
            outputSchema: { type: 'object' }
          },
          runner
        )
      ).rejects.toThrow('AI provider returned non-JSON output.')
    } finally {
      if (originalHelper === undefined) delete process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER
      else process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER = originalHelper
    }
  })

  it('detects a configured Apple Intelligence helper', async () => {
    const originalHelper = process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER
    process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER = '/tmp/qa-scribe-apple-helper'
    const runner: CommandRunner = async (command, args) => {
      if (command === '/tmp/qa-scribe-apple-helper' && args.join(' ') === 'status --json') {
        return { code: 0, stdout: '{"available":true}', stderr: '' }
      }
      return {
        code: null,
        stdout: '',
        stderr: '',
        error: Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
    }

    try {
      await expect(detectProviderStatuses(runner)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'apple_intelligence',
            available: true,
            defaultModel: 'system-language-model'
          })
        ])
      )
    } finally {
      if (originalHelper === undefined) delete process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER
      else process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER = originalHelper
    }
  })

  it('runs a configured Apple Intelligence helper with prompt and schema over stdin', async () => {
    const originalHelper = process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER
    process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER = '/tmp/qa-scribe-apple-helper'
    const calls: Array<{ command: string; args: string[]; input?: string }> = []
    const runner: CommandRunner = async (command, args, options) => {
      calls.push({ command, args, input: options.input })
      return {
        code: 0,
        stdout: JSON.stringify({ answer: 'ok' }),
        stderr: ''
      }
    }

    try {
      await expect(
        generateStructuredOutput(
          {
            provider: 'apple_intelligence',
            model: 'system-language-model',
            reasoningEffort: null,
            prompt: 'reviewed generation context',
            outputSchema: { type: 'object' }
          },
          runner
        )
      ).resolves.toEqual({ answer: 'ok' })

      expect(calls).toEqual([
        expect.objectContaining({
          command: '/tmp/qa-scribe-apple-helper',
          args: ['generate', '--json'],
          input: JSON.stringify({
            model: 'system-language-model',
            prompt: 'reviewed generation context',
            outputSchema: { type: 'object' }
          })
        })
      ])
    } finally {
      if (originalHelper === undefined) delete process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER
      else process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER = originalHelper
    }
  })
})
