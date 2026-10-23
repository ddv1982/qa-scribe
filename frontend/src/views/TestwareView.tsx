import type { RecordCreationCommands } from './RecordCreationActions'
import { Box } from 'lucide-react'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import {
  parseTestwareGenerationMetadata,
  testwareDepthLabel,
  testwareOutputFormatLabel,
  testwareTechniqueLabel,
} from '../testware/generationPreferences'
import type { Draft, GenerationJobStatus } from '../tauri'
import type { BusyAction } from '../ui/types'
import type { RecordLoadState } from '../app/useRecordHydration'
import type { ClipboardSnapshot, CopyState } from '../app/copyActions'
import type { CreatedRecordEditTarget } from '../app/types'
import { RecordCollectionView, type RecordCollectionLabels } from './RecordCollectionView'

const testwareLabels: RecordCollectionLabels = {
  eyebrow: 'Test cases',
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
  composer, settleCreation,
  creationCommands,
  busyAction,
  copyState,
  draftScreenshotCounts,
  drafts,
  sessionTitle = null,
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
  settleCreation?: () => Promise<boolean>
  composer?: import('react').ReactNode
  creationCommands: RecordCreationCommands
  busyAction: BusyAction | null
  copyState: CopyState
  draftScreenshotCounts: Record<string, number>
  drafts: Draft[]
  sessionTitle?: string | null
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
  onDeleteDraft: (draft: Draft) => void
  onSaveDraft: (draft: Draft) => Promise<boolean>
  onDiscardDraft: (draft: Draft) => void
  onUploadImage: (input: RichEditorImageUpload, recordId: string) => void | Promise<void>
}) {
  return (
    <RecordCollectionView
      composer={composer} settleCreation={settleCreation}
      creationCommands={creationCommands}
      labels={testwareLabels}
      emptyIcon={Box}
      busyAction={busyAction}
      sourceKind="draft"
      copyState={copyState}
      recordScreenshotCounts={draftScreenshotCounts}
      records={drafts}
      sessionTitle={sessionTitle}
      notice={notice}
      error={error}
      isBusy={isBusy}
      activeGenerationJob={activeGenerationJob}
      initialSelectedRecordId={initialSelectedRecordId}
      createdRecordEditTarget={createdRecordEditTarget}
      onCreatedRecordEditTargetConsumed={onCreatedRecordEditTargetConsumed}
      loadState={loadState}
      loadError={loadError}
      onRetryLoad={onRetryLoad}
      renderListMeta={(draft) => <TestwareGenerationBadges draft={draft} />}
      renderPreviewHeader={(draft) => (
        <div className="record-heading-row">
          <h2 className="record-title">{draft.title}</h2>
          <TestwareGenerationBadges draft={draft} />
        </div>
      )}
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
      onDeleteRecord={onDeleteDraft}
      onSaveRecord={onSaveDraft}
      onDiscardRecord={onDiscardDraft}
      onUploadImage={onUploadImage}
    />
  )
}

function TestwareGenerationBadges({ draft }: { draft: Draft }) {
  const metadata = parseTestwareGenerationMetadata(draft)
  if (!metadata) return null

  return (
    <div className="testware-metadata-badges" aria-label="Test case generation settings">
      <span>{testwareTechniqueLabel(metadata.technique)}</span>
      <span>{testwareDepthLabel(metadata.depth)}</span>
      <span>{testwareOutputFormatLabel(metadata.outputFormat)}</span>
    </div>
  )
}
