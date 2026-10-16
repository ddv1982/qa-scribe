import type { MutableRefObject } from 'react'
import type { useAttachmentActions } from './attachmentActions'
import type { useRecordActions } from './recordActions'
import type { useSessionActions } from './sessionActions'
import type { useSessionChat } from './useSessionChat'
import { useStableCapability } from './useStableCapability'

type AppSettlementContext = {
  chat: Pick<ReturnType<typeof useSessionChat>, 'flush' | 'hasPendingChanges'>
  sessionActions: ReturnType<typeof useSessionActions>
  recordActions: ReturnType<typeof useRecordActions>
  attachmentActions: ReturnType<typeof useAttachmentActions>
  dirtyDraftIdsRef: MutableRefObject<Set<string>>
  dirtyFindingIdsRef: MutableRefObject<Set<string>>
  settingsDirty: boolean
  saveSettingsDraft: () => Promise<boolean>
}

export function createAppSettlement(ctx: AppSettlementContext) {
  async function flush(): Promise<boolean> {
    if (!await ctx.chat.flush()) return false
    for (;;) {
      await ctx.attachmentActions.waitForPendingAttachmentMutations()
      const flushed = await ctx.sessionActions.savePendingSessionEdits()
      await Promise.all([
        ctx.sessionActions.waitForPendingSessionWrites(),
        ctx.recordActions.waitForPendingRecordWrites(),
        ctx.attachmentActions.waitForPendingAttachmentMutations(),
      ])
      const sessionUnchanged = ctx.sessionActions.settlement.checkpoint()
      const sessionCompensated = await ctx.sessionActions.retryAllPendingSessionCompensations()
      const recordsCompensated = await ctx.recordActions.retryAllPendingRecordCompensations()
      const attachmentsCleaned = await ctx.attachmentActions.retryPendingAttachmentCleanup()
      if (!sessionCompensated || !recordsCompensated || !attachmentsCleaned) return false
      if (!flushed) return false
      await Promise.all([
        ctx.sessionActions.waitForPendingSessionWrites(),
        ctx.recordActions.waitForPendingRecordWrites(),
        ctx.attachmentActions.waitForPendingAttachmentMutations(),
      ])
      if (
        sessionUnchanged()
        && !ctx.attachmentActions.hasPendingAttachmentOperations()
        && !ctx.sessionActions.hasPendingSessionEdits()
        && !hasPendingCompensations()
      ) break
    }
    const settingsSaved = !ctx.settingsDirty || await ctx.saveSettingsDraft()
    return settingsSaved && await ctx.chat.flush()
  }

  function hasPendingCompensations() {
    return ctx.sessionActions.hasPendingSessionCompensations()
      || ctx.recordActions.hasPendingRecordCompensations()
      || ctx.attachmentActions.hasPendingAttachmentMutations()
  }

  function hasPendingChanges() {
    return ctx.chat.hasPendingChanges() || ctx.sessionActions.settlement.snapshot().pending
      || ctx.settingsDirty || hasPendingCompensations()
      || ctx.dirtyDraftIdsRef.current.size > 0 || ctx.dirtyFindingIdsRef.current.size > 0
  }
  return { flush, hasPendingChanges, hasPendingCompensations }
}

export type AppSettlement = ReturnType<typeof createAppSettlement>

export function useAppSettlement(ctx: AppSettlementContext) {
  return useStableCapability(ctx, createAppSettlement)
}
