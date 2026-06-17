import { clipboard, dialog, ipcMain, nativeImage } from 'electron'
import { z } from 'zod'
import {
  draftCreateSchema,
  draftPatchSchema,
  entryDraftSchema,
  entryPatchSchema,
  evidenceLinkDraftSchema,
  findingDraftSchema,
  findingPatchSchema,
  appSettingsPatchSchema,
  generationOptionsSchema,
  idSchema,
  sessionDraftSchema,
  sessionPatchSchema
} from '../shared/contracts'
import type { SessionService } from './services/sessionService'

const exportFormatSchema = z.enum(['markdown', 'json'])
const optionalIdSchema = idSchema.optional()
const booleanSchema = z.boolean()

export function registerIpcHandlers(service: SessionService): void {
  ipcMain.handle('settings:get', () => service.getSettings())
  ipcMain.handle('settings:update', (_event, input) => service.updateSettings(appSettingsPatchSchema.parse(input)))
  ipcMain.handle('sessions:list', () => service.listSessions())
  ipcMain.handle('sessions:create', (_event, input) => service.createSession(sessionDraftSchema.parse(input)))
  ipcMain.handle('sessions:get', (_event, id: string) => service.getSession(idSchema.parse(id)))
  ipcMain.handle('sessions:update', (_event, id: string, input) =>
    service.updateSession(idSchema.parse(id), sessionPatchSchema.parse(input))
  )
  ipcMain.handle('sessions:delete', (_event, id: string) => service.deleteSession(idSchema.parse(id)))
  ipcMain.handle('sessions:export', (_event, id: string, format: 'markdown' | 'json') =>
    service.exportSession(idSchema.parse(id), exportFormatSchema.parse(format))
  )
  ipcMain.handle('entries:create', (_event, input) => service.createEntry(entryDraftSchema.parse(input)))
  ipcMain.handle('entries:update', (_event, id: string, input) =>
    service.updateEntry(idSchema.parse(id), entryPatchSchema.parse(input))
  )
  ipcMain.handle('entries:delete', (_event, id: string) => service.deleteEntry(idSchema.parse(id)))
  ipcMain.handle('findings:create', (_event, input) => service.createFinding(findingDraftSchema.parse(input)))
  ipcMain.handle('findings:update', (_event, id: string, input) =>
    service.updateFinding(idSchema.parse(id), findingPatchSchema.parse(input))
  )
  ipcMain.handle('findings:delete', (_event, id: string) => service.deleteFinding(idSchema.parse(id)))
  ipcMain.handle('evidence-links:create', (_event, input) =>
    service.createEvidenceLink(evidenceLinkDraftSchema.parse(input))
  )
  ipcMain.handle('evidence-links:delete', (_event, id: string) => service.deleteEvidenceLink(idSchema.parse(id)))
  ipcMain.handle('drafts:list', (_event, sessionId: string) => service.listDrafts(idSchema.parse(sessionId)))
  ipcMain.handle('drafts:create', (_event, input) => service.createDraft(draftCreateSchema.parse(input)))
  ipcMain.handle('drafts:update', (_event, id: string, input) =>
    service.updateDraft(idSchema.parse(id), draftPatchSchema.parse(input))
  )
  ipcMain.handle('drafts:delete', (_event, id: string) => service.deleteDraft(idSchema.parse(id)))
  ipcMain.handle('drafts:evidence-attachments', (_event, id: string) =>
    service.getDraftEvidenceAttachments(idSchema.parse(id))
  )
  ipcMain.handle('generation-contexts:create', (_event, sessionId: string) =>
    service.createGenerationContext(idSchema.parse(sessionId))
  )
  ipcMain.handle('generation-contexts:update-entry', (_event, contextId: string, entryId: string, included: boolean) =>
    service.updateGenerationContextEntry(idSchema.parse(contextId), idSchema.parse(entryId), booleanSchema.parse(included))
  )
  ipcMain.handle(
    'generation-contexts:update-attachment',
    (_event, contextId: string, attachmentId: string, included: boolean) =>
      service.updateGenerationContextAttachment(
        idSchema.parse(contextId),
        idSchema.parse(attachmentId),
        booleanSchema.parse(included)
      )
  )
  ipcMain.handle('generation:run', (_event, contextId: string, options) =>
    service.generateTestware(idSchema.parse(contextId), generationOptionsSchema.parse(options ?? {}))
  )
  ipcMain.handle('ai:provider-status', () => service.getProviderStatus())
  ipcMain.handle('attachments:import', async (_event, sessionId: string, entryId?: string) => {
    const parsedSessionId = idSchema.parse(sessionId)
    const parsedEntryId = optionalIdSchema.parse(entryId)
    const result = await dialog.showOpenDialog({
      title: 'Import Evidence',
      properties: ['openFile'],
      filters: [
        { name: 'Evidence', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'log', 'json', '*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return service.importAttachment(result.filePaths[0], parsedSessionId, parsedEntryId)
  })
  ipcMain.handle('attachments:import-clipboard-screenshot', (_event, sessionId: string, entryId?: string) => {
    const parsedSessionId = idSchema.parse(sessionId)
    const parsedEntryId = optionalIdSchema.parse(entryId)
    const image = clipboard.readImage()

    if (image.isEmpty()) return null
    return service.importClipboardScreenshot(image.toPNG(), parsedSessionId, parsedEntryId)
  })
  ipcMain.handle('attachments:preview', (_event, id: string) => service.getAttachmentPreviewDataUrl(idSchema.parse(id)))
  ipcMain.handle('attachments:copy-image-to-clipboard', (_event, id: string) => {
    const imageBytes = service.getAttachmentImageBytes(idSchema.parse(id))
    if (!imageBytes) return false

    const image = nativeImage.createFromBuffer(imageBytes)
    if (image.isEmpty()) return false

    clipboard.writeImage(image)
    return true
  })
}
