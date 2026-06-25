import { copyAttachmentImageToClipboard, type Draft, type Finding } from '../tauri'
import { copyRecordForJira, managedAttachmentReferencesForClipboard } from '../editor/clipboardExport'
import type { BusyAction } from '../ui/types'
import { formatError } from '../ui/format'
import type { AppWorkflowContext, CopiedTarget } from './types'

export function createCopyActions(ctx: AppWorkflowContext) {
  function clearCopiedTarget() {
    if (ctx.copySuccessResetRef.current) {
      window.clearTimeout(ctx.copySuccessResetRef.current)
      ctx.copySuccessResetRef.current = null
    }
    ctx.setCopiedTarget(null)
  }

  function markCopiedTarget(target: CopiedTarget) {
    if (ctx.copySuccessResetRef.current) window.clearTimeout(ctx.copySuccessResetRef.current)
    ctx.setCopiedTarget(target)
    ctx.copySuccessResetRef.current = window.setTimeout(() => {
      ctx.setCopiedTarget(null)
      ctx.copySuccessResetRef.current = null
    }, 1800)
  }

  async function handleCopyNoteForJira() {
    if (!ctx.activeSession) return
    const sessionId = ctx.activeSession.id
    try {
      clearCopiedTarget()
      ctx.setBusyAction('copy-note')
      ctx.setError(null)
      await copyRecordForJira({ title: ctx.noteTitle, bodyHtml: ctx.noteBodyHtml })
      markCopiedTarget({ kind: 'note', id: sessionId, action: 'jira-text' })
      ctx.setNotice('Note copied for Jira')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function handleCopyDraftForJira(draft: Draft) {
    try {
      clearCopiedTarget()
      ctx.setBusyAction(`copy-draft:${draft.id}`)
      ctx.setError(null)
      await copyRecordForJira({ title: draft.title, bodyHtml: draft.body })
      markCopiedTarget({ kind: 'draft', id: draft.id, action: 'jira-text' })
      ctx.setNotice('Testware copied for Jira')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function handleCopyFindingForJira(finding: Finding) {
    try {
      clearCopiedTarget()
      ctx.setBusyAction(`copy-finding:${finding.id}`)
      ctx.setError(null)
      await copyRecordForJira({ title: finding.title, bodyHtml: finding.body })
      markCopiedTarget({ kind: 'finding', id: finding.id, action: 'jira-text' })
      ctx.setNotice('Finding copied for Jira')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function copyFirstScreenshotForJira(
    record: { title: string; bodyHtml: string },
    target: CopiedTarget,
    busy: BusyAction,
    successNotice: string,
  ) {
    const [screenshot] = managedAttachmentReferencesForClipboard(record)
    if (!screenshot) {
      ctx.setError('No screenshot found in this record.')
      return
    }

    try {
      clearCopiedTarget()
      ctx.setBusyAction(busy)
      ctx.setError(null)
      await copyAttachmentImageToClipboard(screenshot.attachmentId)
      markCopiedTarget(target)
      ctx.setNotice(successNotice)
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function handleCopyNoteScreenshotForJira() {
    if (!ctx.activeSession) return
    await copyFirstScreenshotForJira(
      { title: ctx.noteTitle, bodyHtml: ctx.noteBodyHtml },
      { kind: 'note', id: ctx.activeSession.id, action: 'screenshot' },
      'copy-note-screenshot',
      'Note screenshot copied',
    )
  }

  async function handleCopyDraftScreenshotForJira(draft: Draft) {
    await copyFirstScreenshotForJira(
      { title: draft.title, bodyHtml: draft.body },
      { kind: 'draft', id: draft.id, action: 'screenshot' },
      `copy-draft-screenshot:${draft.id}`,
      'Testware screenshot copied',
    )
  }

  async function handleCopyFindingScreenshotForJira(finding: Finding) {
    await copyFirstScreenshotForJira(
      { title: finding.title, bodyHtml: finding.body },
      { kind: 'finding', id: finding.id, action: 'screenshot' },
      `copy-finding-screenshot:${finding.id}`,
      'Finding screenshot copied',
    )
  }

  return {
    clearCopiedTarget,
    handleCopyDraftForJira,
    handleCopyDraftScreenshotForJira,
    handleCopyFindingForJira,
    handleCopyFindingScreenshotForJira,
    handleCopyNoteForJira,
    handleCopyNoteScreenshotForJira,
    markCopiedTarget,
  }
}
