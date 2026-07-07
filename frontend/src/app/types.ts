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

export type AppWorkflowState = {
  activeSession: Session | null
  noteEntry: Entry | null
  drafts: Draft[]
  findings: Finding[]
  testwareDraftCount: number
  findingCount: number
  sessions: Session[]
  testwareDrafts: Draft[]
  noteTitle: string
  noteBody: RichEditorDocument
  noteBodyHtml: string
  selectedProvider: AiProvider
  selectedModel: string
  selectedReasoningEffort: string | null
  latestNoteGenerationUndo: LatestNoteGenerationUndo | null
  deleteConfirmation: DeleteConfirmation | null
}

export type AppWorkflowRefs = {
  savedTitleRef: MutableRefObject<string>
  savedBodyRef: MutableRefObject<string>
  noteBodyRef: MutableRefObject<RichEditorDocument>
  noteTitleWriteVersionRef: MutableRefObject<number>
  noteBodyWriteVersionRef: MutableRefObject<number>
  deletingSessionIdRef: MutableRefObject<string | null>
  activeSessionIdRef: MutableRefObject<string | null>
  noteEntryIdRef: MutableRefObject<string | null>
  copySuccessResetRef: MutableRefObject<number | null>
}

export type AppWorkflowSetters = {
  setSessions: Dispatch<SetStateAction<Session[]>>
  setActiveSession: Dispatch<SetStateAction<Session | null>>
  setNoteEntry: Dispatch<SetStateAction<Entry | null>>
  setDrafts: Dispatch<SetStateAction<Draft[]>>
  setFindings: Dispatch<SetStateAction<Finding[]>>
  setTestwareDraftCount: Dispatch<SetStateAction<number>>
  setFindingCount: Dispatch<SetStateAction<number>>
  setNoteTitle: Dispatch<SetStateAction<string>>
  setNoteBody: Dispatch<SetStateAction<RichEditorDocument>>
  setGenerationJobs: Dispatch<SetStateAction<Record<string, GenerationJobStatus>>>
  setBusyAction: Dispatch<SetStateAction<BusyAction | null>>
  setCopiedTarget: Dispatch<SetStateAction<CopiedTarget | null>>
  setNotice: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setActiveView: Dispatch<SetStateAction<MainView>>
  setDeleteConfirmation: Dispatch<SetStateAction<DeleteConfirmation | null>>
  setLatestNoteGenerationUndo: Dispatch<SetStateAction<LatestNoteGenerationUndo | null>>
}

export type AppWorkflowContext = AppWorkflowState & AppWorkflowRefs & AppWorkflowSetters
