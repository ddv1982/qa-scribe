import { PenLine, Sparkles } from 'lucide-react'
import { Segmented, type SegmentedOption } from '../components/Segmented'
import { CreationComposer } from './CreationComposer'
import { useCreationGenerate } from './CreationGenerate'
import { creationAiActive, shownCreationMode } from '../app/creationMode'
import { FindingFields } from './FindingsView'
import { ShowNoteButton } from './CreationNotePanel'
import type { CreationIntent, CreationMode } from '../app/creationIntent'
import type { AppController } from '../app/useAppController'

const creationModes = [{ value: 'write', label: 'Write', icon: PenLine }, { value: 'generate', label: 'Generate', icon: Sparkles }] satisfies ReadonlyArray<SegmentedOption<CreationMode>>

export function CreationWorkspace({ c, onShowNote }: { c: AppController; onShowNote?: () => void }) {
  const intent = c.creationIntent
  if (!intent) return null
  return <CreationDraft key={intent.id} intent={intent} c={c} onShowNote={onShowNote} />
}

/** A new draft: written by hand, or, when AI is ready, generated from the Note shown beside it. */
function CreationDraft({ intent, c, onShowNote }: { intent: CreationIntent; c: AppController; onShowNote?: () => void }) {
  const generation = useCreationGenerate(intent, c)
  const aiActive = creationAiActive(c)
  const mode = shownCreationMode(intent, aiActive)
  return <CreationComposer intent={intent} actions={c.creation} copyState={c.copyState} onCopy={c.copy}
    headerAction={onShowNote ? <ShowNoteButton onShow={onShowNote} /> : undefined}
    modeSwitch={aiActive ? <Segmented label="How to create" options={creationModes} value={mode}
      disabled={intent.phase.state !== 'editing' || generation.busy}
      onChange={(next) => {
        if (!next) return
        if (next === 'generate') {
          c.setError(null)
          generation.followDraftFormat()
        }
        c.creation.setMode(next)
      }} /> : undefined}
    generate={aiActive && mode === 'generate' ? generation.mode() : null}
    fields={intent.kind === 'finding' ? <FindingFields finding={{ kind: intent.findingKind, metadataJson: intent.metadataJson }} onChange={(patch) => c.creation.update({ ...(patch.kind ? { findingKind: patch.kind } : {}), ...('metadataJson' in patch ? { metadataJson: patch.metadataJson } : {}) })} /> : undefined} />
}
