import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evidenceLinkDraftSchema, validateSessionRequirements } from '../../shared/contracts'
import { createDbClient, type DbClient } from '../db/client'
import type { CommandRunner } from './aiProviders'
import { __testables, SessionService } from './sessionService'

type TestHarness = {
  client: DbClient
  root: string
  service: SessionService
}

const harnesses: TestHarness[] = []

afterEach(() => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()
    if (!harness) continue
    if (harness.client.sqlite.open) harness.client.sqlite.close()
    rmSync(harness.root, { force: true, recursive: true })
  }
})

describe('SessionService', () => {
  it('persists created sessions and lists them from the database', () => {
    const first = createHarness()
    const session = first.service.createSession({
      title: 'Checkout regression',
      testTarget: 'Web checkout',
      charter: 'Verify card payment flow',
      environment: 'Staging',
      buildVersion: '2026.06.12',
      relatedReference: 'QA-123'
    })
    const secondSession = first.service.createSession({ title: 'Account settings smoke' })

    expect(first.service.listSessions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: session.id,
          title: 'Checkout regression',
          testTarget: 'Web checkout',
          charter: 'Verify card payment flow',
          environment: 'Staging',
          buildVersion: '2026.06.12',
          relatedReference: 'QA-123'
        }),
        expect.objectContaining({
          id: secondSession.id,
          title: 'Account settings smoke'
        })
      ])
    )
    expect(first.service.listSessions()).toHaveLength(2)

    first.client.sqlite.close()
    const reopened = reopenHarness(first)

    expect(reopened.service.listSessions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: session.id,
          title: 'Checkout regression'
        }),
        expect.objectContaining({
          id: secondSession.id,
          title: 'Account settings smoke'
        })
      ])
    )
    expect(reopened.service.listSessions()).toHaveLength(2)
  })

  it('persists entries for a session', () => {
    const first = createHarness()
    const session = first.service.createSession({ title: 'Search smoke test' })
    const entry = first.service.createEntry({
      sessionId: session.id,
      type: 'observation',
      title: 'Empty state',
      body: 'Search returned a useful empty state.',
      metadataJson: '{"screen":"search"}',
      excludedFromGeneration: true
    })

    expect(first.service.listEntries(session.id)).toEqual([
      expect.objectContaining({
        id: entry.id,
        sessionId: session.id,
        type: 'observation',
        title: 'Empty state',
        body: 'Search returned a useful empty state.',
        metadataJson: '{"screen":"search"}',
        excludedFromGeneration: true
      })
    ])

    first.client.sqlite.close()
    const reopened = reopenHarness(first)

    expect(reopened.service.getSession(session.id)).toEqual(
      expect.objectContaining({
        session: expect.objectContaining({ id: session.id }),
        entries: [
          expect.objectContaining({
            id: entry.id,
            body: 'Search returned a useful empty state.'
          })
        ],
        attachments: []
      })
    )
  })

  it('falls back to an Untitled Session when a title is cleared', () => {
    const { service } = createHarness()
    const session = service.createSession({ title: 'Title to clear' })

    const updated = service.updateSession(session.id, { title: '' })

    expect(updated.title).toBe('Untitled Session')
  })

  it('treats whitespace-only Session requirement fields as missing', () => {
    expect(validateSessionRequirements({ title: '   ', testTarget: '\n\t', charter: '  ' })).toEqual({
      valid: false,
      missing: ['title', 'testTarget', 'testObjective']
    })
  })

  it('exports sessions to markdown and json', () => {
    const { service } = createHarness()
    const session = service.createSession({
      title: 'API notes',
      testTarget: 'Orders API',
      charter: 'Verify order creation',
      environment: 'Local'
    })
    service.createEntry({
      sessionId: session.id,
      type: 'api_response',
      title: 'Create order',
      body: '{"status":201}'
    })
    service.createEntry({
      sessionId: session.id,
      type: 'log',
      body: 'worker processed order event'
    })

    const markdown = service.exportSession(session.id, 'markdown')
    expect(markdown.format).toBe('markdown')
    expect(markdown.content).toContain('# API notes')
    expect(markdown.content).toContain('- Test Target: Orders API')
    expect(markdown.content).toContain('- Environment: Local')
    expect(markdown.content).toContain('### Api Response - ')
    expect(markdown.content).toContain('**Create order**')
    expect(markdown.content).toContain('{"status":201}')
    expect(markdown.content).toContain('### Log - ')
    expect(markdown.content).toContain('worker processed order event')

    const json = service.exportSession(session.id, 'json')
    expect(json.format).toBe('json')
    expect(JSON.parse(json.content)).toEqual(
      expect.objectContaining({
        session: expect.objectContaining({
          id: session.id,
          title: 'API notes',
          testTarget: 'Orders API',
          testObjective: 'Verify order creation'
        }),
        entries: expect.arrayContaining([
          expect.objectContaining({
            type: 'api_response',
            title: 'Create order',
            body: '{"status":201}'
          }),
          expect.objectContaining({
            type: 'log',
            title: null,
            body: 'worker processed order event'
          })
        ]),
        attachments: []
      })
    )
    expect(JSON.parse(json.content).session).not.toHaveProperty('charter')
  })

  it('exports Sessions without changing last opened recency', () => {
    const { client, service } = createHarness()
    const session = service.createSession({ title: 'Side-effect-free export' })
    const lastOpenedAt = '2026-01-01T00:00:00.000Z'
    client.sqlite.prepare('UPDATE sessions SET last_opened_at = ? WHERE id = ?').run(lastOpenedAt, session.id)

    service.exportSession(session.id, 'json')

    expect(client.sqlite.prepare('SELECT last_opened_at FROM sessions WHERE id = ?').get(session.id)).toEqual({
      last_opened_at: lastOpenedAt
    })
  })

  it('persists Findings with linked Entry evidence', () => {
    const { service } = createHarness()
    const session = service.createSession({ title: 'Checkout review' })
    const entry = service.createEntry({
      sessionId: session.id,
      type: 'observation',
      title: 'Payment error',
      body: 'Card error appeared after submitting valid test card.'
    })

    const finding = service.createFinding({
      sessionId: session.id,
      kind: 'bug',
      title: 'Valid card submission fails',
      body: 'The payment flow reports an error after a valid submit.',
      metadataJson: '{"schema":"qa-scribe.structured-finding.v1","actual":"Payment failed"}',
      entryId: entry.id
    })

    const snapshot = service.getSession(session.id)
    expect(snapshot?.findings).toEqual([
      expect.objectContaining({
        id: finding.id,
        title: 'Valid card submission fails',
        kind: 'bug',
        metadataJson: '{"schema":"qa-scribe.structured-finding.v1","actual":"Payment failed"}'
      })
    ])
    expect(snapshot?.evidenceLinks).toEqual([
      expect.objectContaining({
        findingId: finding.id,
        entryId: entry.id,
        attachmentId: null
      })
    ])
  })

  it('rolls back Finding creation when linked Entry evidence is invalid', () => {
    const { service } = createHarness()
    const session = service.createSession({ title: 'Finding rollback' })
    const otherSession = service.createSession({ title: 'Other session' })
    const otherEntry = service.createEntry({
      sessionId: otherSession.id,
      type: 'observation',
      body: 'This evidence belongs elsewhere.'
    })

    expect(() =>
      service.createFinding({
        sessionId: session.id,
        kind: 'bug',
        title: 'Should not persist',
        body: 'The linked evidence is invalid.',
        entryId: otherEntry.id
      })
    ).toThrow(`Entry not found in Session: ${otherEntry.id}`)

    expect(service.getSession(session.id)?.findings).toEqual([])
    expect(service.getSession(session.id)?.evidenceLinks).toEqual([])
  })

  it('rejects Evidence link drafts without an Entry or Attachment at the contract boundary', () => {
    const findingId = '00000000-0000-4000-8000-000000000001'

    expect(() => evidenceLinkDraftSchema.parse({ findingId })).toThrow('Evidence link requires an Entry or Attachment')
  })

  it('imports managed attachment files and links them as evidence', () => {
    const harness = createHarness()
    const session = harness.service.createSession({ title: 'Attachment import' })
    const entry = harness.service.createEntry({
      sessionId: session.id,
      type: 'log',
      body: 'Imported a relevant log file.'
    })
    const sourcePath = join(harness.root, 'source.log')
    writeFileSync(sourcePath, 'worker completed with warning')

    const attachment = harness.service.importAttachment(sourcePath, session.id, entry.id)
    const finding = harness.service.createFinding({
      sessionId: session.id,
      kind: 'risk',
      title: 'Worker emitted warning',
      body: 'The warning may explain later failures.'
    })
    const evidenceLink = harness.service.createEvidenceLink({ findingId: finding.id, attachmentId: attachment.id })

    expect(attachment).toEqual(
      expect.objectContaining({
        sessionId: session.id,
        entryId: entry.id,
        filename: 'source.log',
        mimeType: 'text/plain',
        sizeBytes: 'worker completed with warning'.length
      })
    )
    expect(harness.service.getSession(session.id)?.evidenceLinks).toEqual([
      expect.objectContaining({
        id: evidenceLink.id,
        attachmentId: attachment.id
      })
    ])
  })

  it('creates and updates manual Session Report drafts', () => {
    const { service } = createHarness()
    const session = service.createSession({ title: 'Draft workflow' })

    const draft = service.createDraft({
      sessionId: session.id,
      kind: 'session_report',
      title: 'Manual Report',
      body: '# Report\n\nInitial notes'
    })
    const updated = service.updateDraft(draft.id, {
      title: 'Edited Report',
      body: '# Report\n\nEdited notes'
    })

    expect(updated).toEqual(
      expect.objectContaining({
        id: draft.id,
        title: 'Edited Report',
        body: '# Report\n\nEdited notes'
      })
    )
    expect(service.listDrafts(session.id)).toEqual([expect.objectContaining({ id: draft.id, title: 'Edited Report' })])
  })

  it('builds editable Generation Context reviews from included Entries', () => {
    const { service } = createHarness()
    const session = service.createSession({ title: 'Generation context' })
    const included = service.createEntry({
      sessionId: session.id,
      type: 'note',
      body: 'Include this note.'
    })
    const excluded = service.createEntry({
      sessionId: session.id,
      type: 'log',
      body: 'Do not include this noisy log.',
      excludedFromGeneration: true
    })

    const review = service.createGenerationContext(session.id)
    expect(review.entries).toEqual([
      expect.objectContaining({ entry: expect.objectContaining({ id: included.id }), included: true }),
      expect.objectContaining({ entry: expect.objectContaining({ id: excluded.id }), included: false })
    ])

    const updated = service.updateGenerationContextEntry(review.context.id, excluded.id, true)
    expect(updated.entries.find((item) => item.entry.id === excluded.id)?.included).toBe(true)
  })

  it('includes Session metadata and session-level attachment metadata in Generation Context prompts', () => {
    const harness = createHarness()
    const session = harness.service.createSession({
      title: 'Release candidate checkout',
      testTarget: 'Checkout',
      charter: 'Verify the happy path and payment failures',
      environment: 'Staging',
      buildVersion: '2026.06.12',
      relatedReference: 'QA-456'
    })
    harness.service.createEntry({
      sessionId: session.id,
      type: 'note',
      body: 'Payment failed after submit.'
    })
    const sourcePath = join(harness.root, 'session-log.txt')
    writeFileSync(sourcePath, 'top-level evidence')
    const attachment = harness.service.importAttachment(sourcePath, session.id)

    const review = harness.service.createGenerationContext(session.id)
    const prompt = __testables.buildGenerationPrompt(review)

    expect(review.session).toEqual(expect.objectContaining({ id: session.id, testTarget: 'Checkout' }))
    expect(review.attachments).toEqual([
      expect.objectContaining({ attachment: expect.objectContaining({ id: attachment.id, entryId: null }), included: true })
    ])
    expect(prompt).toContain('- Title: Release candidate checkout')
    expect(prompt).toContain('- Test Target: Checkout')
    expect(prompt).toContain('- Test Objective: Verify the happy path and payment failures')
    expect(prompt).toContain('- Environment: Staging')
    expect(prompt).toContain('- Build/Version: 2026.06.12')
    expect(prompt).toContain('- Related Reference: QA-456')
    expect(prompt).toContain('Session-level Attachments:')
    expect(prompt).toContain('session-log.txt; type=text/plain')
  })

  it('excludes session-level attachments from Generation Context prompts when toggled out', () => {
    const harness = createHarness()
    const session = harness.service.createSession({ title: 'Attachment review' })
    const sourcePath = join(harness.root, 'private-note.txt')
    writeFileSync(sourcePath, 'sensitive setup details')
    const attachment = harness.service.importAttachment(sourcePath, session.id)

    const review = harness.service.createGenerationContext(session.id)
    const updated = harness.service.updateGenerationContextAttachment(review.context.id, attachment.id, false)
    const prompt = __testables.buildGenerationPrompt(updated)

    expect(updated.attachments).toEqual([
      expect.objectContaining({ attachment: expect.objectContaining({ id: attachment.id }), included: false })
    ])
    expect(prompt).toContain('- No session-level attachments were included.')
    expect(prompt).not.toContain('private-note.txt')
  })

  it('persists a failed AI Run when the selected local provider is unavailable', async () => {
    const { service } = createHarness(undefined, missingCommandRunner)
    const session = service.createSession({
      title: 'AI unavailable generation',
      testTarget: 'Checkout',
      charter: 'Generate a report from notes'
    })
    service.createEntry({
      sessionId: session.id,
      type: 'note',
      body: 'Generate from this note.'
    })
    const review = service.createGenerationContext(session.id)

    await expect(service.generateTestware(review.context.id, { provider: 'codex_cli' })).rejects.toThrow(
      'codex was not found on PATH.'
    )
    expect(service.getSession(session.id)?.aiRuns).toEqual([
      expect.objectContaining({
        sessionId: session.id,
        generationContextId: review.context.id,
        provider: 'codex_cli',
        model: 'gpt-5.5',
        reasoningEffort: 'high',
        status: 'failed',
        errorMessage: 'codex was not found on PATH.'
      })
    ])
  })

  it('rejects incomplete Session metadata before provider command execution', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args })
      return { code: 1, stdout: '', stderr: 'provider should not be called' }
    }
    const { service } = createHarness(undefined, runner)
    const session = service.createSession({ title: 'Incomplete generation' })
    service.createEntry({
      sessionId: session.id,
      type: 'note',
      body: 'This note should not be sent to a provider yet.'
    })
    const review = service.createGenerationContext(session.id)

    await expect(service.generateTestware(review.context.id, { provider: 'codex_cli' })).rejects.toThrow(
      'Complete required Session fields before generating: Test Target, Test Objective'
    )
    expect(calls).toEqual([])
    expect(service.getSession(session.id)?.aiRuns).toEqual([])
  })

  it('generates a report draft with a fake authenticated Codex CLI', async () => {
    const calls: Array<{ command: string; args: string[]; input?: string; cwd?: string }> = []
    const runner: CommandRunner = async (command, args, options) => {
      calls.push({ command, args, input: options.input, cwd: options.cwd })
      if (command === 'codex' && args.join(' ') === 'login status') return { code: 0, stdout: 'logged in', stderr: '' }
      if (command === 'claude') return { code: null, stdout: '', stderr: '', error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }
      if (command === 'codex' && args[0] === 'exec') {
        return {
          code: 0,
          stdout: JSON.stringify(fakeGeneratedReport()),
          stderr: ''
        }
      }
      return { code: 1, stdout: '', stderr: 'unexpected command' }
    }
    const { service } = createHarness(undefined, runner)
    const session = service.createSession({
      title: 'AI generation',
      testTarget: 'Checkout',
      charter: 'Create testware from a completed checkout smoke test'
    })
    service.createEntry({
      sessionId: session.id,
      type: 'note',
      body: 'Checkout completed successfully.'
    })
    const review = service.createGenerationContext(session.id)

    const result = await service.generateTestware(review.context.id, {
      provider: 'codex_cli',
      model: 'gpt-5-mini',
      reasoningEffort: 'low'
    })

    expect(result.aiRun).toEqual(
      expect.objectContaining({
        provider: 'codex_cli',
        model: 'gpt-5-mini',
        reasoningEffort: 'low',
        status: 'completed'
      })
    )
    expect(result.draft.body).toContain('# Session Report')
    expect(result.draft.body).toContain('Checkout smoke')
    const execCall = calls.find((call) => call.command === 'codex' && call.args[0] === 'exec')
    expect(execCall).toEqual(expect.objectContaining({ input: expect.stringContaining('Checkout completed successfully.') }))
    expect(execCall?.args).toEqual(
      expect.arrayContaining([
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-c',
        'approval_policy="never"',
        '--model',
        'gpt-5-mini',
        '-c',
        'model_reasoning_effort="low"',
        '--output-schema'
      ])
    )
    expect(execCall?.cwd).toContain('qa-scribe-codex-')
  })

  it('reports provider statuses from local tool detection', async () => {
    const originalAppleHelper = process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER
    delete process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER
    try {
      const { service } = createHarness(undefined, missingCommandRunner)

      await expect(service.getProviderStatus()).resolves.toEqual(
        expect.objectContaining({
          selectedProvider: null,
          selectedModel: null,
          selectedReasoningEffort: null,
          providers: expect.arrayContaining([
            expect.objectContaining({
              provider: 'apple_intelligence',
              label: 'Apple Intelligence',
              available: false,
              reason: 'Apple Intelligence native helper is not bundled or configured.',
              models: ['system-language-model'],
              defaultModel: 'system-language-model',
              reasoningEfforts: []
            }),
            expect.objectContaining({
              provider: 'claude_code',
              label: 'Claude Code',
              available: false,
              reason: 'claude was not found on PATH.',
              reasoningEfforts: ['low', 'medium', 'high'],
              defaultReasoningEffort: 'medium'
            }),
            expect.objectContaining({
              provider: 'codex_cli',
              label: 'Codex CLI',
              available: false,
              reason: 'codex was not found on PATH.',
              defaultModel: 'gpt-5.5',
              reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
              defaultReasoningEffort: 'high'
            }),
            expect.objectContaining({
              provider: 'openai_legacy',
              label: 'OpenAI Legacy',
              available: false
            })
          ])
        })
      )
    } finally {
      if (originalAppleHelper === undefined) delete process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER
      else process.env.QA_SCRIBE_APPLE_INTELLIGENCE_HELPER = originalAppleHelper
    }
  })

  it('records the applied database schema version', () => {
    const { client } = createHarness()

    expect(client.sqlite.pragma('user_version', { simple: true })).toBe(4)
    expect(client.sqlite.prepare('PRAGMA table_info(ai_runs)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'reasoning_effort' })])
    )
    expect(client.sqlite.prepare('PRAGMA table_info(findings)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'metadata_json' })])
    )
  })
})

function createHarness(
  root = mkdtempSync(join(tmpdir(), 'qa-scribe-session-service-')),
  commandRunner?: CommandRunner
): TestHarness {
  const client = createDbClient(join(root, 'user-data'))
  const harness = {
    client,
    root,
    service: new SessionService(client, join(root, 'attachments'), commandRunner)
  }

  harnesses.push(harness)
  return harness
}

function reopenHarness(previous: TestHarness): TestHarness {
  const index = harnesses.indexOf(previous)
  if (index >= 0) harnesses.splice(index, 1)
  return createHarness(previous.root)
}

const missingCommandRunner: CommandRunner = async () => ({
  code: null,
  stdout: '',
  stderr: '',
  error: Object.assign(new Error('missing'), { code: 'ENOENT' })
})

function fakeGeneratedReport(): unknown {
  return {
    whatWasTested: 'Checkout smoke',
    scenariosCovered: ['Card checkout'],
    checks: [{ title: 'Submit order', status: 'passed', notes: 'Order completed.' }],
    findings: [],
    bugs: [],
    openQuestions: [],
    followUpActions: [],
    jiraBugDrafts: []
  }
}
