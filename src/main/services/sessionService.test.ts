import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { defaultAppSettings, evidenceLinkDraftSchema, validateSessionRequirements } from '../../shared/contracts'
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
    harness.client.sqlite.close()
    rmSync(harness.root, { force: true, recursive: true })
  }
})

describe('SessionService', () => {
  it('returns default application settings when no settings have been saved', () => {
    const { service } = createHarness()

    expect(service.getSettings()).toEqual(defaultAppSettings)
  })

  it('persists application settings updates across database reopen', () => {
    const first = createHarness()
    const updated = first.service.updateSettings({
      providers: { claude_code: false },
      generation: { systemPrompt: 'Prefer concise exploratory testing summaries.' }
    })

    expect(updated.providers).toEqual({
      claude_code: false,
      codex_cli: true,
      copilot_cli: true
    })
    expect(updated.generation.systemPrompt).toBe('Prefer concise exploratory testing summaries.')
    expect(updated.templates).toEqual(defaultAppSettings.templates)

    first.client.sqlite.close()
    const reopened = reopenHarness(first)

    expect(reopened.service.getSettings()).toEqual(updated)
  })

  it('updates form templates without replacing unrelated settings', () => {
    const { service } = createHarness()
    const noteTemplate = {
      fields: [
        { id: 'body', label: 'Session note', type: 'rich_text' as const, required: true, enabled: true },
        { id: 'tag', label: 'Tag', type: 'select' as const, required: false, enabled: true, options: ['setup', 'risk'] }
      ]
    }

    service.updateSettings({ providers: { copilot_cli: false } })
    const updated = service.updateSettings({ templates: { note: noteTemplate } })

    expect(updated.providers.copilot_cli).toBe(false)
    expect(updated.templates.note).toEqual(noteTemplate)
    expect(updated.templates.finding).toEqual(defaultAppSettings.templates.finding)
  })

  it('rejects invalid application settings updates', () => {
    const { service } = createHarness()

    expect(() =>
      service.updateSettings({
        generation: { systemPrompt: '' }
      })
    ).toThrow()
    expect(() =>
      service.updateSettings({
        templates: { note: { fields: [{ id: '', label: 'Broken', type: 'text', required: false, enabled: true }] } }
      })
    ).toThrow()
  })

  it('creates the application settings table during migration', () => {
    const { client } = createHarness()

    expect(
      client.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'")
        .get()
    ).toEqual({ name: 'app_settings' })
  })

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
    expect(validateSessionRequirements({ title: '   ' })).toEqual({
      valid: false,
      missing: ['title']
    })
    expect(validateSessionRequirements({ title: 'Only title is required' })).toEqual({
      valid: true,
      missing: []
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
    expect(markdown.content).toContain('- Context: Orders API')
    expect(markdown.content).toContain('- Objective/Notes: Verify order creation')
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

  it('returns data URLs for image attachment previews only', () => {
    const harness = createHarness()
    const session = harness.service.createSession({ title: 'Screenshot preview' })
    const pngPath = join(harness.root, 'screen.png')
    const logPath = join(harness.root, 'source.log')
    const pngBytes = Buffer.from('png bytes')
    writeFileSync(pngPath, pngBytes)
    writeFileSync(logPath, 'plain text')

    const imageAttachment = harness.service.importAttachment(pngPath, session.id)
    const textAttachment = harness.service.importAttachment(logPath, session.id)

    expect(harness.service.getAttachmentPreviewDataUrl(imageAttachment.id)).toBe(
      `data:image/png;base64,${pngBytes.toString('base64')}`
    )
    expect(harness.service.getAttachmentImageBytes(imageAttachment.id)).toEqual(pngBytes)
    expect(harness.service.getAttachmentPreviewDataUrl(textAttachment.id)).toBeNull()
    expect(harness.service.getAttachmentImageBytes(textAttachment.id)).toBeNull()
    expect(harness.service.getAttachmentImageBytes('00000000-0000-4000-8000-000000000001')).toBeNull()
  })

  it('imports clipboard screenshot bytes with image metadata and preview data', () => {
    const harness = createHarness()
    const session = harness.service.createSession({ title: 'Clipboard screenshot import' })
    const entry = harness.service.createEntry({
      sessionId: session.id,
      type: 'screenshot',
      body: 'Pasted screenshot evidence.'
    })
    const pngBytes = Buffer.from('clipboard png bytes')

    const attachment = harness.service.importClipboardScreenshot(pngBytes, session.id, entry.id)

    expect(attachment).toEqual(
      expect.objectContaining({
        sessionId: session.id,
        entryId: entry.id,
        mimeType: 'image/png',
        sizeBytes: pngBytes.length,
        sha256: createHash('sha256').update(pngBytes).digest('hex')
      })
    )
    expect(attachment.filename).toMatch(/^pasted-screenshot-\d{8}-\d{6}\.png$/)
    expect(attachment.relativePath).toBe(`${session.id}/${attachment.id}.png`)
    expect(readFileSync(join(harness.root, 'attachments', attachment.relativePath))).toEqual(pngBytes)
    expect(harness.service.getAttachmentPreviewDataUrl(attachment.id)).toBe(
      `data:image/png;base64,${pngBytes.toString('base64')}`
    )
  })

  it('rejects clipboard screenshot imports for invalid Sessions or Entries', () => {
    const { service } = createHarness()
    const session = service.createSession({ title: 'Clipboard screenshot validation' })
    const otherSession = service.createSession({ title: 'Other session' })
    const otherEntry = service.createEntry({
      sessionId: otherSession.id,
      type: 'note',
      body: 'Evidence belongs to another session.'
    })
    const missingSessionId = '00000000-0000-4000-8000-000000000001'
    const pngBytes = Buffer.from('clipboard png bytes')

    expect(() => service.importClipboardScreenshot(pngBytes, missingSessionId)).toThrow(
      `Session not found: ${missingSessionId}`
    )
    expect(() => service.importClipboardScreenshot(pngBytes, session.id, otherEntry.id)).toThrow(
      `Entry not found in Session: ${otherEntry.id}`
    )
    expect(service.listAttachments(session.id)).toEqual([])
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

  it('resolves included Generation Context attachments for generated drafts', async () => {
    const runner: CommandRunner = async (command, args) => {
      if (command === 'codex' && args.join(' ') === 'login status') return { code: 0, stdout: 'logged in', stderr: '' }
      if (command === 'claude') return { code: null, stdout: '', stderr: '', error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }
      if (command === 'codex' && args[0] === 'exec') return { code: 0, stdout: JSON.stringify(fakeGeneratedReport()), stderr: '' }
      return { code: 1, stdout: '', stderr: 'unexpected command' }
    }
    const harness = createHarness(undefined, runner)
    const session = harness.service.createSession({ title: 'Generated evidence' })
    const includedEntry = harness.service.createEntry({
      sessionId: session.id,
      type: 'screenshot',
      body: 'Included screenshot note.'
    })
    const excludedEntry = harness.service.createEntry({
      sessionId: session.id,
      type: 'screenshot',
      body: 'Excluded screenshot note.',
      excludedFromGeneration: true
    })
    const includedEntryPath = join(harness.root, 'included-entry.png')
    const excludedEntryPath = join(harness.root, 'excluded-entry.png')
    const includedSessionPath = join(harness.root, 'included-session.png')
    const excludedSessionPath = join(harness.root, 'excluded-session.png')
    writeFileSync(includedEntryPath, 'included entry image')
    writeFileSync(excludedEntryPath, 'excluded entry image')
    writeFileSync(includedSessionPath, 'included session image')
    writeFileSync(excludedSessionPath, 'excluded session image')
    const includedEntryAttachment = harness.service.importAttachment(includedEntryPath, session.id, includedEntry.id)
    const excludedEntryAttachment = harness.service.importAttachment(excludedEntryPath, session.id, excludedEntry.id)
    const includedSessionAttachment = harness.service.importAttachment(includedSessionPath, session.id)
    const excludedSessionAttachment = harness.service.importAttachment(excludedSessionPath, session.id)
    const manualDraft = harness.service.createDraft({
      sessionId: session.id,
      kind: 'session_report',
      title: 'Manual Report',
      body: '# Manual'
    })

    const review = harness.service.createGenerationContext(session.id)
    harness.service.updateGenerationContextAttachment(review.context.id, excludedSessionAttachment.id, false)
    const result = await harness.service.generateTestware(review.context.id, { provider: 'codex_cli' })
    const attachmentIds = harness.service.getDraftEvidenceAttachments(result.draft.id).map((attachment) => attachment.id)

    expect(attachmentIds).toEqual(expect.arrayContaining([includedEntryAttachment.id, includedSessionAttachment.id]))
    expect(attachmentIds).not.toContain(excludedEntryAttachment.id)
    expect(attachmentIds).not.toContain(excludedSessionAttachment.id)
    expect(harness.service.getDraftEvidenceAttachments(manualDraft.id)).toEqual([])
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
    expect(prompt).toContain('- Context: Checkout')
    expect(prompt).toContain('- Objective/Notes: Verify the happy path and payment failures')
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

  it('includes a custom system prompt while preserving protected generation instructions', () => {
    const harness = createHarness()
    const session = harness.service.createSession({ title: 'Prompt settings' })
    harness.service.createEntry({
      sessionId: session.id,
      type: 'note',
      body: 'Search returned no results.'
    })

    const review = harness.service.createGenerationContext(session.id)
    const prompt = __testables.buildGenerationPrompt(review, 'Use the tester preferred voice.')

    expect(prompt).toContain('Use the tester preferred voice.')
    expect(prompt).toContain('Use only the information in this context. Do not invent unsupported facts.')
    expect(prompt).toContain('Return concise, scannable structured output that matches the requested schema.')
    expect(prompt).toContain('Search returned no results.')
  })

  it('marks disabled providers unavailable in provider status', async () => {
    const { service } = createHarness(undefined, codexOnlyRunner())
    service.updateSettings({ providers: { codex_cli: false } })

    await expect(service.getProviderStatus()).resolves.toEqual(
      expect.objectContaining({
        selectedProvider: null,
        providers: expect.arrayContaining([
          expect.objectContaining({
            provider: 'codex_cli',
            available: false,
            reason: 'Codex CLI is disabled in Settings.'
          })
        ])
      })
    )
  })

  it('persists a failed AI Run when the selected provider is disabled in settings', async () => {
    const { service } = createHarness(undefined, codexOnlyRunner())
    service.updateSettings({ providers: { codex_cli: false } })
    const session = service.createSession({
      title: 'Disabled AI provider',
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
      'Codex CLI is disabled in Settings.'
    )
    expect(service.getSession(session.id)?.aiRuns).toEqual([
      expect.objectContaining({
        sessionId: session.id,
        generationContextId: review.context.id,
        provider: 'codex_cli',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        status: 'failed',
        errorMessage: 'Codex CLI is disabled in Settings.'
      })
    ])
  })

  it('does not implicitly fall back to Codex when no provider is selectable', async () => {
    const { service } = createHarness(undefined, codexOnlyRunner())
    service.updateSettings({ providers: { codex_cli: false } })
    const session = service.createSession({
      title: 'No selectable provider',
      testTarget: 'Checkout',
      charter: 'Generate a report from notes'
    })
    service.createEntry({
      sessionId: session.id,
      type: 'note',
      body: 'Generate from this note.'
    })
    const review = service.createGenerationContext(session.id)

    await expect(service.generateTestware(review.context.id)).rejects.toThrow(
      'No selectable AI provider is available. Enable an available provider in Settings before generating.'
    )
    expect(service.getSession(session.id)?.aiRuns).toEqual([])
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
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        status: 'failed',
        errorMessage: 'codex was not found on PATH.'
      })
    ])
  })

  it('allows generation when only optional Session context is empty', async () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args })
      if (command === 'codex' && args.join(' ') === 'login status') return { code: 0, stdout: 'logged in', stderr: '' }
      if (command === 'claude') return { code: null, stdout: '', stderr: '', error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }
      if (command === 'codex' && args[0] === 'exec') return { code: 0, stdout: JSON.stringify(fakeGeneratedReport()), stderr: '' }
      return { code: 1, stdout: '', stderr: 'unexpected command' }
    }
    const { service } = createHarness(undefined, runner)
    const session = service.createSession({ title: 'Minimal generation' })
    service.createEntry({
      sessionId: session.id,
      type: 'note',
      body: 'This note can be sent with only a title.'
    })
    const review = service.createGenerationContext(session.id)

    await expect(service.generateTestware(review.context.id, { provider: 'codex_cli' })).resolves.toEqual(
      expect.objectContaining({
        aiRun: expect.objectContaining({ status: 'completed' })
      })
    )
    expect(calls.some((call) => call.command === 'codex' && call.args[0] === 'exec')).toBe(true)
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
    service.updateSettings({ generation: { systemPrompt: 'Write in the tester configured voice.' } })
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
    expect(execCall?.input).toContain('Write in the tester configured voice.')
    expect(execCall?.input).toContain('Use only the information in this context. Do not invent unsupported facts.')
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
    expect(execCall?.cwd).toContain('qa-scribe')
    expect(execCall?.cwd).toContain('provider-runtime')
    expect(execCall?.cwd).toContain('codex')
  })

  it('reports provider statuses from local tool detection', async () => {
    const { service } = createHarness(undefined, missingCommandRunner)

    await expect(service.getProviderStatus()).resolves.toEqual(
      expect.objectContaining({
        selectedProvider: null,
        selectedModel: null,
        selectedReasoningEffort: null,
        providers: expect.arrayContaining([
          expect.objectContaining({
            provider: 'claude_code',
            label: 'Claude Code',
            available: false,
            reason: 'claude was not found on PATH.',
            capabilities: {
              optionDescriptors: [
                expect.objectContaining({
                  id: 'reasoningEffort',
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
          }),
          expect.objectContaining({
            provider: 'codex_cli',
            label: 'Codex CLI',
            available: false,
            reason: 'codex was not found on PATH.',
            defaultModel: 'gpt-5.4',
            capabilities: {
              optionDescriptors: [
                expect.objectContaining({
                  id: 'reasoningEffort',
                  defaultValue: 'high',
                  options: [
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                    { value: 'xhigh', label: 'Extra high' }
                  ]
                })
              ]
            }
          }),
          expect.objectContaining({
            provider: 'copilot_cli',
            label: 'GitHub Copilot CLI',
            available: false,
            reason: 'copilot was not found on PATH.',
            defaultModel: 'auto',
            capabilities: { optionDescriptors: [] }
          })
        ])
      })
    )
  })

  it('records the applied database schema version', () => {
    const { client } = createHarness()

    expect(client.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 })
    expect(client.sqlite.prepare('PRAGMA table_info(ai_runs)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'reasoning_effort' })])
    )
    expect(client.sqlite.prepare('PRAGMA table_info(findings)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'metadata_json' })])
    )
    expect(client.sqlite.prepare('PRAGMA table_info(app_settings)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'value_json' })])
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

function codexOnlyRunner(): CommandRunner {
  return async (command, args) => {
    if (command === 'codex' && args.join(' ') === 'login status') return { code: 0, stdout: 'logged in', stderr: '' }
    if (command === 'codex' && args[0] === 'exec') return { code: 0, stdout: JSON.stringify(fakeGeneratedReport()), stderr: '' }
    return { code: null, stdout: '', stderr: '', error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }
  }
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
    checks: [
      {
        title: 'Submit order',
        status: 'passed',
        expectedResult: 'Order confirmation is displayed.',
        actualResult: 'Order confirmation displayed.',
        evidence: null,
        notes: 'Order completed.'
      }
    ],
    findings: [],
    bugs: [],
    openQuestions: [],
    followUpActions: [],
    jiraBugDrafts: []
  }
}
