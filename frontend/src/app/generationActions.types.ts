import type { RichEditorDocument } from '../editor/editorDocument'
import type { Draft, Finding } from '../tauri'
import type {
  AiSelection,
  GenerationWorkspace,
  RecordWorkspace,
  SessionWorkspace,
  SummaryRecoveryCoordinator,
  WorkflowFeedback,
  WorkflowNavigation,
} from './types'

export type GenerationActionsContext = {
  session: Pick<
    SessionWorkspace,
    | 'activeSession'
    | 'activeSessionIdRef'
    | 'noteBodyRef'
    | 'noteEntry'
    | 'noteEntryIdRef'
    | 'savedBodyRef'
    | 'setNoteBody'
    | 'setNoteEntry'
  >
  records: Pick<
    RecordWorkspace,
    | 'dirtyDraftIdsRef'
    | 'dirtyFindingIdsRef'
    | 'draftsRef'
    | 'findingsRef'
    | 'setDrafts'
    | 'setFindings'
    | 'setFindingCount'
    | 'setTestwareDraftCount'
  >
  generation: GenerationWorkspace
  latestNoteGenerationUndoRef: { current: GenerationWorkspace['latestNoteGenerationUndo'] }
  summaryRecovery: SummaryRecoveryCoordinator
  selection: AiSelection
  feedback: WorkflowFeedback
  navigation: WorkflowNavigation
  saveNoteNow: (options?: { manageBusy?: boolean }) => Promise<boolean>
  saveNoteBody: (body: RichEditorDocument, options?: {
    manageBusy?: boolean
    entryId?: string
    sessionId?: string
    expectedCurrentBody?: string
    allowRecoveryWrite?: boolean
  }) => Promise<boolean>
  adoptCanonicalNoteBody: (body: RichEditorDocument, entryId: string, sessionId: string) => void
  canonicalizeGeneratedDraft: (draft: Draft) => Promise<void>
  canonicalizeGeneratedFinding: (finding: Finding) => Promise<void>
}
