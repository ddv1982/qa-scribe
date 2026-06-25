import { beforeEach, describe, expect, it, vi } from 'vitest'

const coreMock = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve(null)),
  Channel: vi.fn(function Channel(onEvent: unknown) {
    return { onEvent }
  }),
}))

vi.mock('@tauri-apps/api/core', () => coreMock)

import * as tauri from './tauri'

describe('Tauri command bridge', () => {
  beforeEach(() => {
    coreMock.invoke.mockClear()
    coreMock.Channel.mockClear()
  })

  it('maps frontend wrappers to stable Tauri command names', async () => {
    await expectCommand('get_app_status', () => tauri.getAppStatus())
    await expectCommand('get_command_shell_status', () => tauri.getCommandShellStatus())
    await expectCommand('get_settings', () => tauri.getSettings())
    await expectCommand('update_settings', () => tauri.updateSettings({} as tauri.AppSettings))
    await expectCommand('list_sessions', () => tauri.listSessions())
    await expectCommand('create_session', () => tauri.createSession({ title: 'Session' }))
    await expectCommand('reopen_session', () => tauri.reopenSession('session-1'))
    await expectCommand('update_session', () => tauri.updateSession('session-1', { title: 'Session' }))
    await expectCommand('delete_session', () => tauri.deleteSession('session-1'))
    await expectCommand('create_entry', () => tauri.createEntry({} as tauri.EntryDraft))
    await expectCommand('list_entries', () => tauri.listEntries('session-1'))
    await expectCommand('update_entry', () => tauri.updateEntry('entry-1', { title: 'Entry' }))
    await expectCommand('create_finding', () => tauri.createFinding({} as tauri.FindingDraft))
    await expectCommand('list_findings', () => tauri.listFindings('session-1'))
    await expectCommand('update_finding', () => tauri.updateFinding('finding-1', { title: 'Finding' }))
    await expectCommand('delete_finding', () => tauri.deleteFinding('finding-1'))
    await expectCommand('create_evidence_link', () => tauri.createEvidenceLink({ findingId: 'finding-1' }))
    await expectCommand('import_attachment', () => tauri.importAttachment({ sessionId: 'session-1', entryId: null, sourcePath: '/tmp/screenshot.png' }))
    await expectCommand('import_clipboard_screenshot', () =>
      tauri.importClipboardScreenshot({ sessionId: 'session-1', entryId: null, filename: 'screenshot.png', dataUrl: 'data:image/png;base64,' }),
    )
    await expectCommand('list_attachments', () => tauri.listAttachments('session-1'))
    await expectCommand('get_attachment_preview_data_url', () => tauri.getAttachmentPreviewDataUrl('attachment-1'))
    await expectCommand('copy_attachment_image_to_clipboard', () => tauri.copyAttachmentImageToClipboard('attachment-1'))
    await expectCommand('export_session', () => tauri.exportSession('session-1', 'markdown'))
    await expectCommand('create_generation_context', () => tauri.createGenerationContext('session-1'))
    await expectCommand('create_ai_run', () =>
      tauri.createAiRun({ sessionId: 'session-1', generationContextId: null, provider: 'codex_cli', model: 'default', reasoningEffort: null, promptVersion: 'test' }),
    )
    await expectCommand('create_draft', () => tauri.createDraft({ sessionId: 'session-1', aiRunId: null, kind: 'testware', title: 'Draft', body: '' }))
    await expectCommand('list_drafts', () => tauri.listDrafts('session-1'))
    await expectCommand('update_draft', () => tauri.updateDraft('draft-1', { title: 'Draft' }))
    await expectCommand('delete_draft', () => tauri.deleteDraft('draft-1'))
    await expectCommand('get_provider_status', () => tauri.getProviderStatus())
    await expectCommand('refresh_provider_status', () => tauri.refreshProviderStatus())
    await expectCommand('generate_session_report', () => tauri.generateSessionReport({ sessionId: 'session-1', provider: 'codex_cli', model: 'default', reasoningEffort: null }))
    await expectCommand('generate_ai_action', () => tauri.generateAiAction({ sessionId: 'session-1', provider: 'codex_cli', model: 'default', reasoningEffort: null, action: 'summary', noteEntryId: 'entry-1' }))
    await expectCommand('start_ai_action_job', () =>
      tauri.startAiActionJob({ sessionId: 'session-1', provider: 'codex_cli', model: 'default', reasoningEffort: null, action: 'summary', noteEntryId: 'entry-1' }, () => undefined),
    )
    await expectCommand('get_ai_action_job_status', () => tauri.getAiActionJobStatus('job-1'))
    await expectCommand('cancel_ai_action_job', () => tauri.cancelAiActionJob('job-1'))
  })

  it('keeps command shell status focused on implemented command state', () => {
    const status: tauri.CommandShellStatus = {
      appDataDir: '/tmp/qa-scribe',
      databaseFilename: 'qa-scribe.sqlite',
      nativePermissions: [],
      activeJobCount: 0,
      implementedCommands: ['sessions'],
      deferredCommands: [],
    }

    expect('grantedPathCount' in status).toBe(false)
  })
})

async function expectCommand(command: string, run: () => Promise<unknown>) {
  coreMock.invoke.mockClear()
  await run()
  const calls = coreMock.invoke.mock.calls as unknown as Array<[string, ...unknown[]]>
  expect(calls.at(-1)?.[0]).toBe(command)
}
