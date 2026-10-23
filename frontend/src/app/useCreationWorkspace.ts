import { useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { CreationKind } from '../tauri'
import type { MainView } from '../ui/types'
import type { RecordLoaders } from './recordActions'
import type { CreatedRecordEditTarget } from './types'
import { useCreationActions } from './creationActions'

export function useCreationWorkspace(ctx: RecordLoaders & {
  activeSessionIdRef: { current: string | null }
  beginNavigation: () => number
  setActiveView: Dispatch<SetStateAction<MainView>>
  setError: Dispatch<SetStateAction<string | null>>
  setCreatedRecordEditTarget: Dispatch<SetStateAction<CreatedRecordEditTarget | null>>
  consumeCreatedRecordEditTarget: (target: CreatedRecordEditTarget) => void
}) {
  const pendingSelection = useRef<{ id: string; finish: (selected: boolean) => void } | null>(null)
  const workspace = useCreationActions({
    activeSessionId: () => ctx.activeSessionIdRef.current,
    beginNavigation: ctx.beginNavigation,
    openDestination: (kind: CreationKind) => ctx.setActiveView(kind === 'finding' ? 'findings' : 'testware'),
    error: ctx.setError,
    selectSaved: async (intent, result) => {
      if (result.record.sessionId !== intent.sessionId) return false
      const records = result.kind === 'finding'
        ? await ctx.loadFindingsForSession(intent.sessionId, { force: true, replace: true })
        : await ctx.loadDraftsForSession(intent.sessionId, { force: true, replace: true })
      if (ctx.activeSessionIdRef.current !== intent.sessionId || workspace.creation.current()?.id !== intent.id
        || !records.some((record) => record.id === result.record.id)) return false
      ctx.setActiveView(intent.kind === 'finding' ? 'findings' : 'testware')
      ctx.setCreatedRecordEditTarget({ sessionId: intent.sessionId, kind: intent.kind, recordId: result.record.id, editing: false })
      return new Promise<boolean>((finish) => { pendingSelection.current = { id: result.record.id, finish } })
    },
  })
  function consumeSelectedRecord(target: CreatedRecordEditTarget) {
    ctx.consumeCreatedRecordEditTarget(target)
    if (pendingSelection.current?.id === target.recordId) {
      pendingSelection.current.finish(true)
      pendingSelection.current = null
    }
  }
  return { ...workspace, consumeSelectedRecord }
}
