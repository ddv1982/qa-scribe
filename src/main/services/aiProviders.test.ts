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
      '--disallowedTools',
      'mcp__*',
      '--strict-mcp-config',
      '--model',
      'claude-sonnet-4',
      '--effort',
      'high'
    ])
  })

  it('detects authenticated Claude from the current loggedIn status payload', async () => {
    const runner: CommandRunner = async (command, args) => {
      if (command === 'claude' && args.join(' ') === 'auth status --json') {
        return { code: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: '' }
      }
      return missingCommand()
    }

    await expect(detectProviderStatuses(runner)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'claude_code',
          available: true,
          models: ['sonnet', 'haiku', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
          modelDescriptors: expect.arrayContaining([
            expect.objectContaining({
              id: 'sonnet',
              label: 'sonnet',
              capabilities: expect.objectContaining({
                optionDescriptors: [expect.objectContaining({ id: 'reasoningEffort', defaultValue: 'medium' })]
              })
            })
          ]),
          capabilities: {
            optionDescriptors: [
              expect.objectContaining({
                id: 'reasoningEffort',
                type: 'select',
                defaultValue: 'medium',
                options: [
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'xhigh', label: 'Extra high' },
                  { value: 'max', label: 'Max' }
                ]
              })
            ]
          }
        })
      ])
    )
  })

  it('discovers Claude aliases, effort values, and Anthropic models without requiring them for availability', async () => {
    const runner: CommandRunner = async (command, args) => {
      if (command === 'claude' && args.join(' ') === 'auth status --json') {
        return { code: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: '' }
      }
      if (command === 'claude' && args.join(' ') === '--help') {
        return {
          code: 0,
          stdout: 'Options:\n  --model <model>  Use an alias such as sonnet or opus.\n  --effort <effort>  One of low, medium, high.',
          stderr: ''
        }
      }
      if (command === 'ant' && args.join(' ') === 'beta:models list') {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: [
              {
                id: 'claude-sonnet-4-6-20260101',
                display_name: 'Claude Sonnet 4.6',
                capabilities: {
                  effort: {
                    values: ['low', 'medium', 'high'],
                    default_effort: 'high'
                  }
                }
              },
              {
                id: 'claude-haiku-4-5-20251001',
                displayName: 'Claude Haiku 4.5',
                supported_reasoning_efforts: ['low']
              }
            ]
          }),
          stderr: ''
        }
      }
      return missingCommand()
    }

    await expect(detectProviderStatuses(runner)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'claude_code',
          available: true,
          defaultModel: 'sonnet',
          models: expect.arrayContaining(['sonnet', 'haiku', 'claude-sonnet-4-6-20260101', 'claude-haiku-4-5-20251001']),
          capabilities: {
            optionDescriptors: [
              expect.objectContaining({
                id: 'reasoningEffort',
                defaultValue: 'medium',
                options: [
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' }
                ]
              })
            ]
          },
          modelDescriptors: expect.arrayContaining([
            expect.objectContaining({
              id: 'claude-sonnet-4-6-20260101',
              label: 'Claude Sonnet 4.6',
              capabilities: {
                optionDescriptors: [
                  expect.objectContaining({
                    id: 'reasoningEffort',
                    defaultValue: 'high',
                    options: [
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'high', label: 'High' }
                    ]
                  })
                ]
              }
            }),
            expect.objectContaining({
              id: 'claude-haiku-4-5-20251001',
              label: 'Claude Haiku 4.5',
              capabilities: {
                optionDescriptors: [expect.objectContaining({ defaultValue: null, options: [{ value: 'low', label: 'Low' }] })]
              }
            })
          ])
        })
      ])
    )
  })

  it('detects unauthenticated Claude from current and older status payloads', async () => {
    for (const statusPayload of [{ loggedIn: false }, { authenticated: false }]) {
      const runner: CommandRunner = async (command, args) => {
        if (command === 'claude' && args.join(' ') === 'auth status --json') {
          return { code: 0, stdout: JSON.stringify(statusPayload), stderr: '' }
        }
        return missingCommand()
      }

      await expect(detectProviderStatuses(runner)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'claude_code',
            available: false,
            reason: 'claude is installed but is not authenticated.'
          })
        ])
      )
    }
  })

  it('detects installed and missing Copilot CLI states', async () => {
    const installedRunner: CommandRunner = async (command, args) => {
      if (command === 'copilot' && args.join(' ') === 'version') {
        return { code: 0, stdout: 'GitHub Copilot CLI 1.0.63', stderr: '' }
      }
      return missingCommand()
    }

    await expect(detectProviderStatuses(installedRunner)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'copilot_cli',
          label: 'GitHub Copilot CLI',
          available: true,
          defaultModel: 'auto',
          models: ['auto', 'gpt-5.3-codex', 'gpt-5.2', 'claude-sonnet-4.6', 'claude-haiku-4.5'],
          capabilities: { optionDescriptors: [] }
        })
      ])
    )

    await expect(detectProviderStatuses(async () => missingCommand())).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'copilot_cli',
          available: false,
          reason: 'copilot was not found on PATH.'
        })
      ])
    )
  })

  it('discovers Copilot models from help config with reasoning on concrete models', async () => {
    const runner: CommandRunner = async (command, args) => {
      if (command === 'copilot' && args.join(' ') === 'version') {
        return { code: 0, stdout: 'GitHub Copilot CLI 1.0.63', stderr: '' }
      }
      if (command === 'copilot' && args.join(' ') === 'help config') {
        return {
          code: 0,
          stdout: `Configuration Settings:\n\n  \`model\`: AI model to use for Copilot CLI; can be changed with /model command or --model flag option.\n    - "claude-sonnet-4.6"\n    - "gpt-5.4"\n    - "gemini-3.5-flash"\n\n  \`contextTier\`: context window tier.`,
          stderr: ''
        }
      }
      return missingCommand()
    }

    await expect(detectProviderStatuses(runner)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'copilot_cli',
          available: true,
          defaultModel: 'auto',
          models: ['auto', 'claude-sonnet-4.6', 'gpt-5.4', 'gemini-3.5-flash'],
          modelDescriptors: [
            expect.objectContaining({ id: 'auto', capabilities: { optionDescriptors: [] } }),
            expect.objectContaining({
              id: 'claude-sonnet-4.6',
              capabilities: {
                optionDescriptors: [
                  expect.objectContaining({
                    id: 'reasoningEffort',
                    defaultValue: null,
                    options: [
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'high', label: 'High' },
                      { value: 'xhigh', label: 'Extra high' },
                      { value: 'max', label: 'Max' }
                    ]
                  })
                ]
              }
            }),
            expect.objectContaining({ id: 'gpt-5.4' }),
            expect.objectContaining({ id: 'gemini-3.5-flash' })
          ],
          reasoningEfforts: [],
          defaultReasoningEffort: null
        })
      ])
    )
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

  it('discovers Codex models and model-specific reasoning from app-server model/list', async () => {
    const runner: CommandRunner = async (command, args, options) => {
      if (command === 'codex' && args.join(' ') === 'login status') return { code: 0, stdout: 'logged in', stderr: '' }
      if (command === 'codex' && args.join(' ') === 'app-server --stdio') {
        expect(options.input).toContain('"method":"model/list"')
        return {
          code: 0,
          stdout: `${JSON.stringify({
            id: 1,
            result: {
              data: [
                {
                  id: 'gpt-5.4',
                  displayName: 'GPT-5.4',
                  defaultReasoningEffort: 'medium',
                  supportedReasoningEfforts: [
                    { reasoningEffort: 'low', description: 'Lower latency' },
                    { reasoningEffort: 'medium', description: 'Balanced' }
                  ],
                  isDefault: true
                },
                {
                  id: 'gpt-5.4-mini',
                  displayName: 'GPT-5.4 mini',
                  defaultReasoningEffort: 'low',
                  supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }]
                }
              ]
            }
          })}\n`,
          stderr: ''
        }
      }
      return missingCommand()
    }

    await expect(detectProviderStatuses(runner)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'codex_cli',
          available: true,
          defaultModel: 'gpt-5.4',
          models: ['gpt-5.4', 'gpt-5.4-mini'],
          modelDescriptors: [
            expect.objectContaining({
              id: 'gpt-5.4',
              label: 'GPT-5.4',
              capabilities: {
                optionDescriptors: [
                  expect.objectContaining({
                    id: 'reasoningEffort',
                    defaultValue: 'medium',
                    options: [
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' }
                    ]
                  })
                ]
              }
            }),
            expect.objectContaining({
              id: 'gpt-5.4-mini',
              capabilities: {
                optionDescriptors: [expect.objectContaining({ defaultValue: 'low', options: [{ value: 'low', label: 'Low' }] })]
              }
            })
          ],
          reasoningEfforts: ['low', 'medium'],
          defaultReasoningEffort: 'medium'
        })
      ])
    )
  })

  it('keeps Codex available with static metadata when app-server discovery fails', async () => {
    const runner: CommandRunner = async (command, args) => {
      if (command === 'codex' && args.join(' ') === 'login status') return { code: 0, stdout: 'logged in', stderr: '' }
      if (command === 'codex' && args.join(' ') === 'app-server --stdio') return { code: 1, stdout: '', stderr: 'unsupported' }
      return missingCommand()
    }

    await expect(detectProviderStatuses(runner)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'codex_cli',
          available: true,
          defaultModel: 'gpt-5.4',
          models: ['gpt-5.4', 'gpt-5.4-mini'],
          defaultReasoningEffort: 'high'
        })
      ])
    )
  })

  it('runs Copilot with prompt, model, no-ask-user flag, provider runtime cwd, and JSON-only schema instruction', async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = []
    const runner: CommandRunner = async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd })
      return {
        code: 0,
        stdout: JSON.stringify({ answer: 'ok' }),
        stderr: ''
      }
    }

    await expect(
      generateStructuredOutput(
        {
          provider: 'copilot_cli',
          model: 'gpt-5.3-codex',
          reasoningEffort: null,
          prompt: 'reviewed generation context',
          outputSchema: { type: 'object' }
        },
        runner
      )
    ).resolves.toEqual({ answer: 'ok' })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(expect.objectContaining({ command: 'copilot' }))
    expect(calls[0].cwd).toContain('qa-scribe')
    expect(calls[0].cwd).toContain('provider-runtime')
    expect(calls[0].cwd).toContain('copilot')
    expect(calls[0].args).toEqual([
      '-p',
      expect.stringContaining('reviewed generation context'),
      '-s',
      '--no-ask-user',
      '--model',
      'gpt-5.3-codex'
    ])
    expect(calls[0].args[1]).toContain('Return only a JSON value')
    expect(calls[0].args[1]).toContain(JSON.stringify({ type: 'object' }))
  })

  it('passes Copilot reasoning effort when one is selected', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args })
      return { code: 0, stdout: JSON.stringify({ answer: 'ok' }), stderr: '' }
    }

    await expect(
      generateStructuredOutput(
        {
          provider: 'copilot_cli',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          prompt: 'reviewed generation context',
          outputSchema: { type: 'object' }
        },
        runner
      )
    ).resolves.toEqual({ answer: 'ok' })

    expect(calls[0].args).toEqual([
      '-p',
      expect.stringContaining('reviewed generation context'),
      '-s',
      '--no-ask-user',
      '--model',
      'gpt-5.4',
      '--effort',
      'high'
    ])
  })

  it('rejects invalid structured output from CLI adapters', async () => {
    const runner: CommandRunner = async () => ({
      code: 0,
      stdout: 'not json',
      stderr: ''
    })

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
          provider: 'copilot_cli',
          model: 'auto',
          reasoningEffort: null,
          prompt: 'reviewed generation context',
          outputSchema: { type: 'object' }
        },
        runner
      )
    ).rejects.toThrow('AI provider returned non-JSON output.')
  })
})

function missingCommand(): Awaited<ReturnType<CommandRunner>> {
  return {
    code: null,
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('missing'), { code: 'ENOENT' })
  }
}
