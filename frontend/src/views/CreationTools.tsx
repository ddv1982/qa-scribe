import { useState } from 'react'
import { PenLine, Sparkles } from 'lucide-react'
import { Segmented } from '../components/Segmented'
import { CreationComposer } from './CreationComposer'
import { creationAiActive, useCreationGenerate } from './CreationGenerate'
import { FindingFields } from './FindingsView'
import { ShowNoteButton } from './CreationNotePanel'
import type { CreationIntent } from '../app/creationIntent'
import type { AppController } from '../app/useAppController'

type CreationMode = 'write' | 'generate'
const creationModes = [{ value: 'write', label: 'Write', icon: PenLine }, { value: 'generate', label: 'Generate', icon: Sparkles }] as const

export function CreationWorkspace({ c, onShowNote }: { c: AppController; onShowNote?: () => void }) {
  const intent = c.creationIntent
  if (!intent) return null
  return <CreationDraft key={intent.id} intent={intent} c={c} onShowNote={onShowNote} />
}

/** A new draft: written by hand, or, when AI is ready, generated from the Note shown beside it. */
function CreationDraft({ intent, c, onShowNote }: { intent: CreationIntent; c: AppController; onShowNote?: () => void }) {
  const [mode, setMode] = useState<CreationMode>(intent.setup === 'ai' ? 'generate' : 'write')
  const generation = useCreationGenerate(intent, c)
  const aiActive = creationAiActive(c)
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
        setMode(next)
      }} /> : undefined}
    generate={aiActive && mode === 'generate' ? generation.mode() : null}
    fields={intent.kind === 'finding' ? <FindingFields finding={{ kind: intent.findingKind, metadataJson: intent.metadataJson }} onChange={(patch) => c.creation.update({ ...(patch.kind ? { findingKind: patch.kind } : {}), ...('metadataJson' in patch ? { metadataJson: patch.metadataJson } : {}) })} /> : undefined} />
}
