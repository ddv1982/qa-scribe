import { copyAttachmentImageToClipboard, type Draft, type Finding } from '../tauri'
import { copyRecordForJira, managedAttachmentReferencesForClipboard } from '../editor/clipboardExport'
import type { BusyAction } from '../ui/types'
import { formatError } from '../ui/format'
import type { CopiedTarget, CopyFeedback, SessionWorkspace, WorkflowFeedback } from './types'
import { useStableCapability } from './useStableCapability'

export type CopyActionsContext = {
  source: Pick<SessionWorkspace, 'activeSession' | 'sessionTitle' | 'noteBodyHtml'>
  feedback: WorkflowFeedback
  copy: CopyFeedback
}

export function createCopyActions(ctx: CopyActionsContext) {
  function clearCopiedTarget() {
    if (ctx.copy.copySuccessResetRef.current) {
      window.clearTimeout(ctx.copy.copySuccessResetRef.current)
      ctx.copy.copySuccessResetRef.current = null
    }
    ctx.copy.setCopiedTarget(null)
  }

  function markCopiedTarget(target: CopiedTarget) {
    if (ctx.copy.copySuccessResetRef.current) window.clearTimeout(ctx.copy.copySuccessResetRef.current)
    ctx.copy.setCopiedTarget(target)
    ctx.copy.copySuccessResetRef.current = window.setTimeout(() => {
      ctx.copy.setCopiedTarget(null)
      ctx.copy.copySuccessResetRef.current = null
    }, 1800)
  }

  async function copyTextForJira(record: { title: string; bodyHtml: string }, target: CopiedTarget, busy: BusyAction, successNotice: string) {
    try {
      clearCopiedTarget()
      ctx.feedback.setBusyAction(busy)
      ctx.feedback.setError(null)
      await copyRecordForJira(record)
      markCopiedTarget(target)
      ctx.feedback.setNotice(successNotice)
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  async function handleCopyNoteForJira() {
    if (!ctx.source.activeSession) return
    await copyTextForJira(
      { title: ctx.source.sessionTitle, bodyHtml: ctx.source.noteBodyHtml },
      { kind: 'note', id: ctx.source.activeSession.id, action: 'jira-text' },
      'copy-note',
      'Note copied for Jira',
    )
  }

  async function handleCopyDraftForJira(draft: Draft) {
    await copyTextForJira(
      { title: draft.title, bodyHtml: draft.body },
      { kind: 'draft', id: draft.id, action: 'jira-text' },
      `copy-draft:${draft.id}`,
      'Testware copied for Jira',
    )
  }

  async function handleCopyFindingForJira(finding: Finding) {
    await copyTextForJira(
      { title: finding.title, bodyHtml: finding.body },
      { kind: 'finding', id: finding.id, action: 'jira-text' },
      `copy-finding:${finding.id}`,
      'Finding copied for Jira',
    )
  }

  async function copyFirstScreenshotForJira(
    record: { title: string; bodyHtml: string },
    target: CopiedTarget,
    busy: BusyAction,
    successNotice: string,
  ) {
    const [screenshot] = managedAttachmentReferencesForClipboard(record)
    if (!screenshot) {
      ctx.feedback.setError('No screenshot found in this record.')
      return
    }

    try {
      clearCopiedTarget()
      ctx.feedback.setBusyAction(busy)
      ctx.feedback.setError(null)
      await copyAttachmentImageToClipboard(screenshot.attachmentId)
      markCopiedTarget(target)
      ctx.feedback.setNotice(successNotice)
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  async function handleCopyNoteScreenshotForJira() {
    if (!ctx.source.activeSession) return
    await copyFirstScreenshotForJira(
      { title: ctx.source.sessionTitle, bodyHtml: ctx.source.noteBodyHtml },
      { kind: 'note', id: ctx.source.activeSession.id, action: 'screenshot' },
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

export function useCopyActions(ctx: CopyActionsContext) {
  return useStableCapability(ctx, createCopyActions)
}
