import { Buffer } from 'node:buffer'
import { BrowserView, Utils } from 'electrobun/bun'
import { z } from 'zod'
import {
  appSettingsPatchSchema,
  draftCreateSchema,
  draftPatchSchema,
  entryDraftSchema,
  entryPatchSchema,
  evidenceLinkDraftSchema,
  findingDraftSchema,
  findingPatchSchema,
  generationOptionsSchema,
  idSchema,
  sessionDraftSchema,
  sessionPatchSchema
} from '../shared/contracts'
import type { QaScribeRpcSchema } from '../shared/rpc'
import type { SessionService } from '../main/services/sessionService'

const exportFormatSchema = z.enum(['markdown', 'json'])
const optionalIdSchema = idSchema.optional()
const booleanSchema = z.boolean()
const evidenceFileTypes = 'png,jpg,jpeg,gif,webp,txt,log,json,*'

type RpcWithTransport = {
  setTransport: (transport: any) => void
}

export function createQaScribeRpc(service: SessionService): RpcWithTransport {
  return BrowserView.defineRPC<QaScribeRpcSchema>({
    maxRequestTime: Infinity,
    handlers: {
      requests: {
        getSettings: () => service.getSettings(),
        updateSettings: (input) => service.updateSettings(appSettingsPatchSchema.parse(input)),
        listSessions: () => service.listSessions(),
        createSession: (input) => service.createSession(sessionDraftSchema.parse(input)),
        getSession: ({ id }) => service.getSession(idSchema.parse(id)),
        updateSession: ({ id, input }) => service.updateSession(idSchema.parse(id), sessionPatchSchema.parse(input)),
        deleteSession: ({ id }) => service.deleteSession(idSchema.parse(id)),
        createEntry: (input) => service.createEntry(entryDraftSchema.parse(input)),
        updateEntry: ({ id, input }) => service.updateEntry(idSchema.parse(id), entryPatchSchema.parse(input)),
        deleteEntry: ({ id }) => service.deleteEntry(idSchema.parse(id)),
        createFinding: (input) => service.createFinding(findingDraftSchema.parse(input)),
        updateFinding: ({ id, input }) => service.updateFinding(idSchema.parse(id), findingPatchSchema.parse(input)),
        deleteFinding: ({ id }) => service.deleteFinding(idSchema.parse(id)),
        createEvidenceLink: (input) => service.createEvidenceLink(evidenceLinkDraftSchema.parse(input)),
        deleteEvidenceLink: ({ id }) => service.deleteEvidenceLink(idSchema.parse(id)),
        listDrafts: ({ sessionId }) => service.listDrafts(idSchema.parse(sessionId)),
        createDraft: (input) => service.createDraft(draftCreateSchema.parse(input)),
        updateDraft: ({ id, input }) => service.updateDraft(idSchema.parse(id), draftPatchSchema.parse(input)),
        deleteDraft: ({ id }) => service.deleteDraft(idSchema.parse(id)),
        getDraftEvidenceAttachments: ({ id }) => service.getDraftEvidenceAttachments(idSchema.parse(id)),
        createGenerationContext: ({ sessionId }) => service.createGenerationContext(idSchema.parse(sessionId)),
        updateGenerationContextEntry: ({ contextId, entryId, included }) =>
          service.updateGenerationContextEntry(
            idSchema.parse(contextId),
            idSchema.parse(entryId),
            booleanSchema.parse(included)
          ),
        updateGenerationContextAttachment: ({ contextId, attachmentId, included }) =>
          service.updateGenerationContextAttachment(
            idSchema.parse(contextId),
            idSchema.parse(attachmentId),
            booleanSchema.parse(included)
          ),
        generateTestware: ({ contextId, options }) =>
          service.generateTestware(idSchema.parse(contextId), generationOptionsSchema.parse(options ?? {})),
        exportSession: ({ id, format }) =>
          service.exportSession(idSchema.parse(id), exportFormatSchema.parse(format)),
        getProviderStatus: () => service.getProviderStatus(),
        importAttachment: async ({ sessionId, entryId }) => {
          const parsedSessionId = idSchema.parse(sessionId)
          const parsedEntryId = optionalIdSchema.parse(entryId)
          const filePaths = await Utils.openFileDialog({
            allowedFileTypes: evidenceFileTypes,
            canChooseFiles: true,
            canChooseDirectory: false,
            allowsMultipleSelection: false
          })
          const sourcePath = filePaths.find((path) => path.trim().length > 0)

          if (!sourcePath) return null
          return service.importAttachment(sourcePath, parsedSessionId, parsedEntryId)
        },
        importClipboardScreenshot: ({ sessionId, entryId }) => {
          const parsedSessionId = idSchema.parse(sessionId)
          const parsedEntryId = optionalIdSchema.parse(entryId)
          const imageBytes = Utils.clipboardReadImage()

          if (!imageBytes) return null
          return service.importClipboardScreenshot(Buffer.from(imageBytes), parsedSessionId, parsedEntryId)
        },
        getAttachmentPreviewDataUrl: ({ id }) => service.getAttachmentPreviewDataUrl(idSchema.parse(id)),
        copyAttachmentImageToClipboard: ({ id }) => {
          const imageBytes = service.getAttachmentImageBytes(idSchema.parse(id))
          if (!imageBytes) return false

          try {
            Utils.clipboardWriteImage(imageBytes)
            return true
          } catch {
            return false
          }
        }
      },
      messages: {}
    }
  })
}
