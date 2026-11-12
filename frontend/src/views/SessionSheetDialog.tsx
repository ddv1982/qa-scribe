import { useId, useRef, useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { Badge } from '../components/Badge'
import { Dialog } from '../components/Dialog'
import { Field } from '../components/Field'
import type { Session } from '../tauri'
import { formatError } from '../ui/format'

/** The Session fields the sheet edits. The charter is stored as Objective Notes. */
export type SessionSheetPatch = Pick<Session,
  'objectiveNotes' | 'relatedReference' | 'timeboxMinutes' | 'debriefNotes' | 'testingPercent' | 'bugPercent' | 'setupPercent'>

type SheetValues = {
  charter: string
  reference: string
  timebox: string
  debrief: string
  testing: string
  bug: string
  setup: string
}

const text = (value: string | null | undefined) => value ?? ''
const number = (value: number | null | undefined) => typeof value === 'number' ? String(value) : ''
const cleared = (value: string) => value.trim() || null
const wholeNumber = (value: string) => /^\d+$/.test(value.trim()) ? Number(value.trim()) : null

function hasDebrief(session: Session): boolean {
  return Boolean(session.debriefNotes) || typeof session.testingPercent === 'number'
}

function hasSessionSheet(session: Session): boolean {
  return Boolean(session.objectiveNotes || session.relatedReference)
    || typeof session.timeboxMinutes === 'number' || hasDebrief(session)
}

/** Turns the form into a patch, or explains the first problem. Blank fields clear. */
function sheetPatch(values: SheetValues): { patch: SessionSheetPatch } | { error: string } {
  let timeboxMinutes: number | null = null
  if (values.timebox.trim()) {
    timeboxMinutes = wholeNumber(values.timebox)
    if (timeboxMinutes === null || timeboxMinutes < 1 || timeboxMinutes > 1440) {
      return { error: 'Timebox must be a whole number of minutes from 1 to 1440.' }
    }
  }
  const split = [values.testing, values.bug, values.setup]
  const filled = split.filter((value) => value.trim()).length
  let percents: (number | null)[] = [null, null, null]
  if (filled > 0) {
    if (filled < 3) return { error: 'Fill in all three percentages, or leave all three empty.' }
    percents = split.map(wholeNumber)
    if (percents.some((percent) => percent === null || percent > 100)) {
      return { error: 'Each percentage must be a whole number from 0 to 100.' }
    }
    if (percents.reduce<number>((sum, percent) => sum + (percent ?? 0), 0) !== 100) {
      return { error: 'The three percentages must add up to 100.' }
    }
  }
  const [testingPercent, bugPercent, setupPercent] = percents
  return {
    patch: {
      objectiveNotes: cleared(values.charter),
      relatedReference: cleared(values.reference),
      timeboxMinutes,
      debriefNotes: cleared(values.debrief),
      testingPercent,
      bugPercent,
      setupPercent,
    },
  }
}

/** The Session sheet: an optional charter, reference, timebox and debrief, saved explicitly. */
export function SessionSheetDialog({ session, onSave, onCancel }: {
  session: Session
  /** Persists the patch. Rejects to keep the dialog open with the error. */
  onSave: (patch: SessionSheetPatch) => Promise<void>
  onCancel: () => void
}) {
  const [values, setValues] = useState<SheetValues>(() => ({
    charter: text(session.objectiveNotes),
    reference: text(session.relatedReference),
    timebox: number(session.timeboxMinutes),
    debrief: text(session.debriefNotes),
    testing: number(session.testingPercent),
    bug: number(session.bugPercent),
    setup: number(session.setupPercent),
  }))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const charterRef = useRef<HTMLTextAreaElement>(null)
  const splitHintId = useId()
  const bind = (key: keyof SheetValues) => ({
    value: values[key],
    onChange: (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value })),
  })
  const percentInput = (key: 'testing' | 'bug' | 'setup') => (
    <input type="number" inputMode="numeric" min={0} max={100} aria-describedby={splitHintId} {...bind(key)} />
  )

  async function save() {
    const result = sheetPatch(values)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(result.patch)
    } catch (cause) {
      setError(formatError(cause))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Session sheet"
      description={<p>Optional. State what this Session explores, and wrap it up when you finish.</p>}
      initialFocus={charterRef}
      onCancel={onCancel}
      actions={<>
        <ActionButton variant="secondary" disabled={saving} onClick={onCancel}>Cancel</ActionButton>
        <ActionButton variant="primary" loading={saving} onClick={() => void save()}>Save</ActionButton>
      </>}
    >
      <div className="session-sheet-body">
        {/* Field's label wraps its hint too, so the charter names its control explicitly. */}
        <Field label="Charter" hint="What this Session sets out to explore.">
          <textarea ref={charterRef} aria-label="Charter" rows={3} placeholder="Explore … to find …" {...bind('charter')} />
        </Field>
        <Field label="Ticket or reference">
          <input type="text" placeholder="Issue ID or URL" {...bind('reference')} />
        </Field>
        <Field label="Timebox (minutes)">
          <input type="number" inputMode="numeric" min={1} max={1440} placeholder="45" {...bind('timebox')} />
        </Field>
        <fieldset className="session-sheet-debrief">
          <legend>Debrief</legend>
          <div className="session-sheet-body">
            <Field label="Debrief notes">
              <textarea rows={3} placeholder="What you covered, what is left, and what got in the way." {...bind('debrief')} />
            </Field>
            <div className="session-sheet-split">
              <Field label="Testing %">{percentInput('testing')}</Field>
              <Field label="Bug investigation %">{percentInput('bug')}</Field>
              <Field label="Setup %">{percentInput('setup')}</Field>
            </div>
            <p className="field-description" id={splitHintId}>The three add up to 100. Leave all empty to skip.</p>
          </div>
        </fieldset>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  )
}

/** One quiet row under the Session title. It renders nothing while the sheet is empty. */
export function SessionSheetRow({ session, onOpen }: { session: Session; onOpen: () => void }) {
  if (!hasSessionSheet(session)) return null
  return (
    <button type="button" className="session-sheet-row" aria-label="Edit Session sheet" onClick={onOpen}>
      {session.objectiveNotes ? <span className="session-sheet-charter">{session.objectiveNotes}</span> : null}
      {typeof session.timeboxMinutes === 'number' ? <Badge>{session.timeboxMinutes} min</Badge> : null}
      {session.relatedReference ? <Badge><span className="session-sheet-reference">{session.relatedReference}</span></Badge> : null}
      {hasDebrief(session) ? <Badge>Debriefed</Badge> : null}
    </button>
  )
}
