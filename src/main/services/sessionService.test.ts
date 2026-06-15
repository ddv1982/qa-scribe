import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evidenceLinkDraftSchema } from '../../shared/contracts'
import { createDbClient, type DbClient } from '../db/client'
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

  it('exports sessions to markdown and json', () => {
    const { service } = createHarness()
    const session = service.createSession({
      title: 'API notes',
      testTarget: 'Orders API',
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
          testTarget: 'Orders API'
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
      entryId: entry.id
    })

    const snapshot = service.getSession(session.id)
    expect(snapshot?.findings).toEqual([
      expect.objectContaining({
        id: finding.id,
        title: 'Valid card submission fails',
        kind: 'bug'
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
    expect(prompt).toContain('- Charter: Verify the happy path and payment failures')
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

  it('persists a failed AI Run when generation is requested without an API key', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    try {
      const { service } = createHarness()
      const session = service.createSession({ title: 'AI offline generation' })
      service.createEntry({
        sessionId: session.id,
        type: 'note',
        body: 'Generate from this note.'
      })
      const review = service.createGenerationContext(session.id)

      await expect(service.generateTestware(review.context.id)).rejects.toThrow('OPENAI_API_KEY is not configured')
      expect(service.getSession(session.id)?.aiRuns).toEqual([
        expect.objectContaining({
          sessionId: session.id,
          generationContextId: review.context.id,
          provider: 'openai',
          status: 'failed',
          errorMessage: 'OPENAI_API_KEY is not configured'
        })
      ])
    } finally {
      restoreEnv('OPENAI_API_KEY', originalApiKey)
    }
  })

  it('reports an unconfigured provider when OPENAI_API_KEY is absent', () => {
    const originalApiKey = process.env.OPENAI_API_KEY
    const originalModel = process.env.OPENAI_MODEL
    delete process.env.OPENAI_API_KEY
    process.env.OPENAI_MODEL = 'gpt-test-model'

    try {
      const { service } = createHarness()

      expect(service.getProviderStatus()).toEqual({
        configured: false,
        provider: null,
        model: null
      })
    } finally {
      restoreEnv('OPENAI_API_KEY', originalApiKey)
      restoreEnv('OPENAI_MODEL', originalModel)
    }
  })

  it('records the applied database schema version', () => {
    const { client } = createHarness()

    expect(client.sqlite.pragma('user_version', { simple: true })).toBe(2)
  })
})

function createHarness(root = mkdtempSync(join(tmpdir(), 'qa-scribe-session-service-'))): TestHarness {
  const client = createDbClient(join(root, 'user-data'))
  const harness = {
    client,
    root,
    service: new SessionService(client, join(root, 'attachments'))
  }

  harnesses.push(harness)
  return harness
}

function reopenHarness(previous: TestHarness): TestHarness {
  const index = harnesses.indexOf(previous)
  if (index >= 0) harnesses.splice(index, 1)
  return createHarness(previous.root)
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
