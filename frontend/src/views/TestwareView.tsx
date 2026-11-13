import type { RecordChatActions } from '../app/sessionChat.context'
import type { RecordCreationCommands } from './RecordCreationActions'
import { Box } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Badge } from '../components/Badge'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import { testwareGenerationSummary } from '../testware/generationPreferences'
import type { Draft, GenerationJobStatus, TestRunCase } from '../tauri'
import type { BusyAction } from '../ui/types'
import type { RecordLoadState } from '../app/useRecordHydration'
import type { ClipboardSnapshot, CopyState } from '../app/copyActions'
import type { CreatedRecordEditTarget } from '../app/types'
import { useTestRuns } from '../testware/useTestRuns'
import { CoverageLine } from './CoverageLine'
import { RecordCollectionView, type RecordCollectionLabels } from './RecordCollectionView'
import { LastTestRunLine, StartTestRunButton } from './TestRunEntryPoints'
import { TestRunView } from './TestRunView'

const testwareLabels: RecordCollectionLabels = {
  heading: 'Test cases',
  emptyTitle: 'No test cases yet',
  emptyDescription: 'Create test cases, then edit and save them here.',
  generationTitle: 'Generating test cases',
  generationTitleAriaLabel: 'Pending test case title',
  generationPlaceholder: 'Preparing test cases...',
  generationBodyAriaLabel: 'Pending generated test cases',
  editorIdPrefix: 'testware-editor',
  titleInputLabel: 'Test case title',
  recordNounLower: 'test case',
  bodyAriaLabelSuffix: 'test case',
  placeholder: 'Write test cases...',
  previewFallbackHtml: '<p>No test case detail yet.</p>',
}

export function TestwareView({
  composer, settleCreation, recordChat,
  sessionId = null,
  acceptanceCriteria = null,
  onCreateFinding,
  onOpenFinding,
  creationCommands,
  busyAction,
  copyState,
  draftScreenshotCounts,
  drafts,
  notice,
  error,
  isBusy,
  activeGenerationJob,
  initialSelectedRecordId = null,
  createdRecordEditTarget = null,
  onCreatedRecordEditTargetConsumed,
  loadState = 'ready',
  loadError = null,
  onRetryLoad,
  updateLocalDraft,
  onCancelGenerationJob,
  onCopy,
  onDeleteDraft,
  onSaveDraft,
  onDiscardDraft,
  onUploadImage,
}: {
  /** The active Session, whose test cases can be run. Without it no test run is offered. */
  sessionId?: string | null
  /** The active Session's acceptance criteria, shown as a coverage line above the test cases. */
  acceptanceCriteria?: string | null
  /** Starts a Finding from a failed test case of a test run. */
  onCreateFinding?: (testCase: TestRunCase) => void
  /** Opens a Finding of the Session in its Findings tab. */
  onOpenFinding?: (findingId: string) => void
  recordChat?: RecordChatActions
  settleCreation?: () => Promise<boolean>
  composer?: import('react').ReactNode
  creationCommands: RecordCreationCommands
  busyAction: BusyAction | null
  copyState: CopyState
  draftScreenshotCounts: Record<string, number>
  drafts: Draft[]
  notice: string | null
  error: string | null
  isBusy: boolean
  activeGenerationJob: GenerationJobStatus | null
  initialSelectedRecordId?: string | null
  createdRecordEditTarget?: CreatedRecordEditTarget | null
  onCreatedRecordEditTargetConsumed?: (target: CreatedRecordEditTarget) => void
  loadState?: RecordLoadState
  loadError?: string | null
  onRetryLoad?: () => void
  updateLocalDraft: (id: string, patch: Partial<Pick<Draft, 'title' | 'body' | 'bodyJson' | 'bodyFormat'>>) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopy: (snapshot: ClipboardSnapshot) => Promise<void>
  /** Asks to delete a draft, told how many test runs go with it. */
  onDeleteDraft: (draft: Draft, testRunCount: number) => void
  onSaveDraft: (draft: Draft) => Promise<boolean>
  onDiscardDraft: (draft: Draft) => void
  onUploadImage: (input: RichEditorImageUpload, recordId: string) => void | Promise<void>
}) {
  const testRuns = useTestRuns(sessionId)
  useShownTestRun(recordChat, sessionId, testRuns)
  const runsOf = (draftId: string) => testRuns.summaries.filter((summary) => summary.draftId === draftId)
  return (
    <RecordCollectionView
      composer={composer} settleCreation={settleCreation} recordChat={recordChat}
      creationCommands={creationCommands}
      labels={testwareLabels}
      emptyIcon={Box}
      busyAction={busyAction}
      sourceKind="draft"
      copyState={copyState}
      recordScreenshotCounts={draftScreenshotCounts}
      records={drafts}
      notice={notice}
      error={testRuns.startError ?? (testRuns.open ? null : testRuns.error) ?? error}
      isBusy={isBusy}
      activeGenerationJob={activeGenerationJob}
      initialSelectedRecordId={initialSelectedRecordId}
      createdRecordEditTarget={createdRecordEditTarget}
      onCreatedRecordEditTargetConsumed={onCreatedRecordEditTargetConsumed}
      loadState={loadState}
      loadError={loadError}
      onRetryLoad={onRetryLoad}
      renderSummary={(savedDrafts) => <CoverageLine acceptanceCriteria={acceptanceCriteria} records={savedDrafts} latestRuns={testRuns.latestRuns} />}
      renderListMeta={(draft) => <TestwareGenerationBadges draft={draft} />}
      renderPreviewHeader={(draft) => {
        const lastRun = runsOf(draft.id)[0]
        return <>
          <div className="record-heading-row">
            <h2 className="record-title">{draft.title}</h2>
            <TestwareGenerationBadges draft={draft} />
          </div>
          {lastRun ? <LastTestRunLine summary={lastRun} onOpen={() => void testRuns.openRun(lastRun.id, draft.id)} /> : null}
        </>
      }}
      renderActions={(draft, editing) => sessionId && !editing
        ? <StartTestRunButton draft={draft} starting={testRuns.starting} disabled={isBusy} onStart={(cases) => void testRuns.start(draft.id, cases)} />
        : null}
      renderDetail={(draft) => testRuns.open?.draftId === draft.id ? (
        <TestRunView open={testRuns.open} draftRuns={runsOf(draft.id)} error={testRuns.error}
          onCreateFinding={onCreateFinding} onOpenFinding={onOpenFinding}
          onSelectRun={(runId) => void testRuns.openRun(runId, draft.id)} onBack={testRuns.close}
          onDelete={testRuns.deleteRun} onChangeCase={testRuns.changeCase}
          askAi={recordChat?.onAskAiRun ? { expanded: recordChat.openRunId === testRuns.open.runId, onOpen: recordChat.onAskAiRun } : undefined} />
      ) : null}
      onSelectedRecordChange={testRuns.keepForDraft}
      busyActionFor={(draft, kind) => {
        switch (kind) {
          case 'delete':
            return `delete-draft:${draft.id}`
          case 'saving':
            return `draft:${draft.id}`
        }
      }}
      updateLocalRecord={updateLocalDraft}
      onCancelGenerationJob={onCancelGenerationJob}
      onCopy={onCopy}
      onDeleteRecord={(draft) => onDeleteDraft(draft, runsOf(draft.id).length)}
      onSaveRecord={onSaveDraft}
      onDiscardRecord={onDiscardDraft}
      onUploadImage={onUploadImage}
    />
  )
}

/** Tells Ask AI which test run the run screen shows, so its panel names the run and closes when the run leaves. */
function useShownTestRun(recordChat: RecordChatActions | undefined, sessionId: string | null, testRuns: ReturnType<typeof useTestRuns>) {
  const show = useRef(recordChat?.onShowRun)
  useEffect(() => { show.current = recordChat?.onShowRun })
  const { open, openRun } = testRuns
  const runId = open?.runId ?? null
  const draftId = open?.draftId ?? null
  const draftTitle = open?.run?.draftTitle ?? null
  const createdAt = open?.run?.createdAt ?? null
  const error = open?.error ?? null
  useEffect(() => {
    show.current?.(sessionId && runId && draftId ? { sessionId, runId, draftTitle, createdAt, error, retry: () => void openRun(runId, draftId) } : null)
  }, [sessionId, runId, draftId, draftTitle, createdAt, error, openRun])
  useEffect(() => () => show.current?.(null), [])
}

function TestwareGenerationBadges({ draft }: { draft: Draft }) {
  const summary = testwareGenerationSummary(draft)
  if (!summary) return null

  return (
    <div className="testware-metadata-badges" title={summary.detail}>
      <Badge>{summary.format}</Badge>
    </div>
  )
}
