import { useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { CreationKind, GenerationJobStatus } from '../tauri'
import type { MainView } from '../ui/types'
import type { RecordLoaders } from './recordActions'
import type { CreatedRecordEditTarget } from './types'
import { useCreationActions, type CreationSelection } from './creationActions'

export function useCreationWorkspace(ctx: RecordLoaders & {
  sourceAllowed: boolean
  noteEntryIdRef: { current: string | null }
  navigationIsCurrent: (epoch: number) => boolean
  publishJob: (status: GenerationJobStatus) => void
  activeSessionIdRef: { current: string | null }
  beginNavigation: () => number
  setActiveView: Dispatch<SetStateAction<MainView>>
  setNotice: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setCreatedRecordEditTarget: Dispatch<SetStateAction<CreatedRecordEditTarget | null>>
  consumeCreatedRecordEditTarget: (target: CreatedRecordEditTarget) => void
}) {
  const pendingSelection = useRef<{ target: CreatedRecordEditTarget; intentId: string; epoch: number; finish: (selected: CreationSelection) => void } | null>(null)
  const workspace = useCreationActions({
    activeSessionId: () => ctx.activeSessionIdRef.current,
    sourceAllowed: () => ctx.sourceAllowed, beginNavigation: ctx.beginNavigation, noteId: () => ctx.noteEntryIdRef.current, navigationIsCurrent: ctx.navigationIsCurrent, publishJob: ctx.publishJob,
    openDestination: (kind: CreationKind) => ctx.setActiveView(kind === 'finding' ? 'findings' : 'testware'),
    error: ctx.setError, notice: ctx.setNotice,
    selectSaved: async (intent, result) => {
      if (result.record.sessionId !== intent.sessionId) return 'stale'
      const records = result.kind === 'finding'
        ? await ctx.loadFindingsForSession(intent.sessionId, { force: true, replace: true })
        : await ctx.loadDraftsForSession(intent.sessionId, { force: true, replace: true })
      if (ctx.activeSessionIdRef.current !== intent.sessionId || workspace.creation.current()?.id !== intent.id) return 'stale'
      if (!records.some((record) => record.id === result.record.id)) return 'deleted'
      if (!workspace.creation.markSelectionReady(intent.id, result.record.id)) return 'stale'
      ctx.setActiveView(intent.kind === 'finding' ? 'findings' : 'testware')
      const target = { sessionId: intent.sessionId, kind: intent.kind, recordId: result.record.id, editing: false }
      ctx.setCreatedRecordEditTarget(target)
      return new Promise<CreationSelection>((finish) => { pendingSelection.current = { target, intentId: intent.id, epoch: intent.epoch, finish } })
    },
  })
  function consumeSelectedRecord(target: CreatedRecordEditTarget) {
    ctx.consumeCreatedRecordEditTarget(target)
    const pending = pendingSelection.current
    const current = workspace.creation.current()
    if (pending && current?.id === pending.intentId && current.epoch === pending.epoch
      && pending.target.recordId === target.recordId && pending.target.sessionId === target.sessionId && pending.target.kind === target.kind) {
      pending.finish('selected')
      pendingSelection.current = null
    }
  }
  return { ...workspace, consumeSelectedRecord }
}
