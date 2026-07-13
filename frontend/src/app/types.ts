import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AiProvider, Draft, Entry, Finding, GenerationJobStatus, Session } from '../tauri'
import type { RichEditorDocument } from '../editor/editorDocument'
import type { BusyAction, MainView } from '../ui/types'
import type { DeleteConfirmation } from '../workflows/deleteConfirmation'

export type CopiedTargetAction = 'jira-text' | 'screenshot'
export type CopiedTarget =
  | { kind: 'note'; id: string; action: CopiedTargetAction }
  | { kind: 'draft'; id: string; action: CopiedTargetAction }
  | { kind: 'finding'; id: string; action: CopiedTargetAction }

export type LatestNoteGenerationUndo = {
  entryId: string
  before: RichEditorDocument
}

export type RichRecordPatch = Partial<Pick<Draft, 'title' | 'body' | 'bodyJson' | 'bodyFormat'>>
export type FindingRecordPatch = RichRecordPatch & Partial<Pick<Finding, 'kind' | 'metadataJson'>>

export type SessionWorkspace = {
  activeSession: Session | null
  noteEntry: Entry | null
  sessions: Session[]
  sessionTitle: string
  noteBody: RichEditorDocument
  noteBodyHtml: string
  savedTitleRef: MutableRefObject<string>
  savedBodyRef: MutableRefObject<string>
  noteBodyRef: MutableRefObject<RichEditorDocument>
  sessionTitleWriteVersionRef: MutableRefObject<number>
  noteBodyWriteVersionRef: MutableRefObject<number>
  deletingSessionIdRef: MutableRefObject<string | null>
  activeSessionIdRef: MutableRefObject<string | null>
  noteEntryIdRef: MutableRefObject<string | null>
  suppressAmbientNoteSaveRef: MutableRefObject<boolean>
  forcedPendingSaveRef: MutableRefObject<Promise<boolean> | null>
  setSessions: Dispatch<SetStateAction<Session[]>>
  setActiveSession: Dispatch<SetStateAction<Session | null>>
  setNoteEntry: Dispatch<SetStateAction<Entry | null>>
  setSessionTitle: Dispatch<SetStateAction<string>>
  setNoteBody: Dispatch<SetStateAction<RichEditorDocument>>
}

export type RecordWorkspace = {
  drafts: Draft[]
  findings: Finding[]
  dirtyDraftIdsRef: MutableRefObject<Set<string>>
  dirtyFindingIdsRef: MutableRefObject<Set<string>>
  draftsRef: MutableRefObject<Draft[]>
  findingsRef: MutableRefObject<Finding[]>
  setDrafts: Dispatch<SetStateAction<Draft[]>>
  setFindings: Dispatch<SetStateAction<Finding[]>>
  setTestwareDraftCount: Dispatch<SetStateAction<number>>
  setFindingCount: Dispatch<SetStateAction<number>>
}

export type GenerationWorkspace = {
  latestNoteGenerationUndo: LatestNoteGenerationUndo | null
  setGenerationJobs: Dispatch<SetStateAction<Record<string, GenerationJobStatus>>>
  setLatestNoteGenerationUndo: Dispatch<SetStateAction<LatestNoteGenerationUndo | null>>
}

export type AiSelection = {
  selectedProvider: AiProvider
  selectedModel: string
  selectedReasoningEffort: string | null
}

export type WorkflowFeedback = {
  setBusyAction: Dispatch<SetStateAction<BusyAction | null>>
  setNotice: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

export type WorkflowNavigation = {
  setActiveView: Dispatch<SetStateAction<MainView>>
}

export type DeletionWorkspace = {
  deleteConfirmation: DeleteConfirmation | null
  setDeleteConfirmation: Dispatch<SetStateAction<DeleteConfirmation | null>>
}

export type CopyFeedback = {
  copySuccessResetRef: MutableRefObject<number | null>
  setCopiedTarget: Dispatch<SetStateAction<CopiedTarget | null>>
}
