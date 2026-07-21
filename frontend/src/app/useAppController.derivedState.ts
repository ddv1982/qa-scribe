import { useMemo } from 'react'
import type { Draft, Finding, GenerateAiActionKind, GenerationJobStatus, Session } from '../tauri'
import {
  richEditorDocumentToPlainText,
  type RichEditorDocument,
} from '../editor/editorDocument'
import { managedAttachmentReferencesForClipboard } from '../editor/clipboardExport'
import { countWords } from '../ui/format'
import type { PendingAiActions } from '../ui/types'
import { generationIsActive } from './generationActions'

type PresentationStateOptions = {
  drafts: Draft[]
  findings: Finding[]
  noteBody: RichEditorDocument
  noteBodyHtml: string
  searchQuery: string
  sessionTitle: string
  sessions: Session[]
}

export function useAppControllerPresentationState({
  drafts,
  findings,
  noteBody,
  noteBodyHtml,
  searchQuery,
  sessionTitle,
  sessions,
}: PresentationStateOptions) {
  const testwareDrafts = useMemo(() => drafts.filter((draft) => draft.kind === 'testware'), [drafts])
  const noteScreenshotCount = useMemo(
    () => managedAttachmentReferencesForClipboard({ title: sessionTitle, bodyHtml: noteBodyHtml }).length,
    [noteBodyHtml, sessionTitle],
  )
  const draftScreenshotCounts = useMemo(
    () =>
      Object.fromEntries(
        testwareDrafts.map((draft) => [
          draft.id,
          managedAttachmentReferencesForClipboard({ title: draft.title, bodyHtml: draft.body }).length,
        ]),
      ),
    [testwareDrafts],
  )
  const findingScreenshotCounts = useMemo(
    () =>
      Object.fromEntries(
        findings.map((finding) => [
          finding.id,
          managedAttachmentReferencesForClipboard({ title: finding.title, bodyHtml: finding.body }).length,
        ]),
      ),
    [findings],
  )
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    if (!query) return sessions
    return sessions.filter((session) => session.title.toLocaleLowerCase().includes(query))
  }, [sessions, searchQuery])
  const noteWordCount = useMemo(() => countWords(richEditorDocumentToPlainText(noteBody)), [noteBody])

  return {
    draftScreenshotCounts,
    filteredSessions,
    findingScreenshotCounts,
    noteScreenshotCount,
    noteWordCount,
    testwareDrafts,
  }
}

type GenerationStateOptions = {
  activeSession: Session | null
  generationJobs: Record<string, GenerationJobStatus>
}

export function useAppControllerGenerationState({ activeSession, generationJobs }: GenerationStateOptions) {
  const activeSessionJobs = useMemo(
    () => Object.values(generationJobs).filter((job) => activeSession && job.sessionId === activeSession.id && generationIsActive(job)),
    [generationJobs, activeSession],
  )
  const pendingAiActions = useMemo<PendingAiActions>(() => {
    const pending: PendingAiActions = {}
    // `job.action` is the backend's `GenerationJobStatus.action: String`, which
    // is always a `GenerateAiActionKind` value.
    for (const job of activeSessionJobs) pending[job.action as GenerateAiActionKind] = true
    return pending
  }, [activeSessionJobs])

  return {
    activeFindingJob: activeSessionJobs.find((job) => job.action === 'finding') ?? null,
    activeTestwareJob: activeSessionJobs.find((job) => job.action === 'testware') ?? null,
    pendingAiActions,
  }
}
