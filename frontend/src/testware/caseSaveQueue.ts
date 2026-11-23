import type { TestCaseNoteImage, TestCaseNotes, TestCaseResult, TestRunCase } from '../tauri'
import { formatError, toCommandError } from '../ui/format'

/** What a tester sets on a test case. The store always takes both, so both are always sent. */
export type CaseValue = { result: TestCaseResult; remark: string | null }
type NotesDraft = { notes: TestCaseNotes; images: TestCaseNoteImage[] }
export type CasePatch = Partial<CaseValue> & { notesDraft?: NotesDraft }
export type EditableTestCase = TestRunCase & { notesSave?: 'saving' | 'failed'; notesError?: string; pendingNoteImages?: readonly TestCaseNoteImage[] }

type Entry = {
  /** What the store returned last. A failed save shows this again. */
  confirmed: TestRunCase
  changes: Partial<CaseValue>
  savingResult?: Partial<CaseValue>
  sending: boolean
  savedImages: Set<string>
  notesDraft?: NotesDraft
  notesError?: string
}

export type CaseSaveListener = {
  /** The case as the screen should show it now. Not called once detached. */
  onShow: (testCase: EditableTestCase) => void
  /** Status and remark changes have settled. Also called once detached. */
  onSaved: (caseId: string) => void
  /** A save failed; the case shows its stored value again and its unsaved changes are dropped. */
  onError: (caseId: string, cause: unknown) => void
  /** A save failed after the queue was detached, when nothing on screen can show it. */
  onBackgroundError: (caseId: string, cause: unknown) => void
}

const sameValue = (left: CaseValue, right: CaseValue) => left.result === right.result && left.remark === right.remark

/**
 * Saves the changes of one test run's cases. Per case at most one save is in flight; changes made
 * meanwhile are merged and the latest value is sent when it settles, so an older save can never land
 * after a newer one. Different cases save independently.
 *
 * A change the tester made is always stored: after `detach`, when the screen has moved on, the queue
 * shows nothing but keeps saving until it is idle. It still takes a change then: a remark committed
 * as its input goes away arrives just after the screen moved on.
 */
export class CaseSaveQueue {
  private readonly entries = new Map<string, Entry>()
  private attached = true
  private inFlight = 0
  private idleWaiters: Array<() => void> = []

  constructor(
    cases: TestRunCase[],
    private readonly save: (caseId: string, value: CaseValue) => Promise<TestRunCase>,
    private listener: CaseSaveListener,
    private readonly saveNotes?: (caseId: string, draft: NotesDraft) => Promise<TestRunCase>,
  ) {
    for (const testCase of cases) this.entries.set(testCase.id, { confirmed: testCase, changes: {}, sending: false, savedImages: new Set() })
  }

  has(caseId: string): boolean {
    return this.entries.has(caseId)
  }

  change(caseId: string, patch: CasePatch) {
    const entry = this.entries.get(caseId)
    if (!entry) return
    const { notesDraft, ...result } = patch
    entry.changes = { ...entry.changes, ...result }
    if (notesDraft) {
      const images = new Map(entry.notesDraft?.images.map(image => [image.id, image]))
      for (const image of notesDraft.images) images.set(image.id, image)
      entry.notesDraft = {
        ...notesDraft,
        images: [...images.values()].filter(image => !entry.savedImages.has(image.id) && notesDraft.notes.bodyJson.includes(`"qa-scribe-attachment://${image.id}"`)),
      }
      entry.notesError = undefined
    }
    this.show(entry)
    if (!entry.sending) this.send(caseId, entry)
  }

  /** Stops showing changes; every change asked for still goes through. */
  detach() {
    this.attached = false
  }

  attach(cases: TestRunCase[], listener: CaseSaveListener): EditableTestCase[] {
    this.listener = listener
    this.attached = true
    return cases.map(testCase => {
      const entry = this.entries.get(testCase.id)
      if (!entry) return testCase
      entry.confirmed = testCase
      return this.display(entry)
    })
  }

  get hasPendingNotes(): boolean {
    return [...this.entries.values()].some(entry => Boolean(entry.notesDraft))
  }

  retryNotes(caseId?: string) {
    for (const [id, entry] of this.entries) {
      if ((caseId && id !== caseId) || !entry.notesError) continue
      entry.notesError = undefined
      this.show(entry)
      if (!entry.sending) this.send(id, entry)
    }
  }

  get idle(): boolean {
    return this.inFlight === 0
  }

  /** Resolves once no save is in flight or waiting, whether the last one succeeded or failed. */
  whenIdle(): Promise<void> {
    return this.idle ? Promise.resolve() : new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private display(entry: Entry): EditableTestCase {
    return {
      ...entry.confirmed,
      ...entry.savingResult,
      ...entry.changes,
      ...entry.notesDraft && {
        notes: entry.notesDraft.notes,
        notesSave: entry.notesError ? 'failed' : 'saving',
        notesError: entry.notesError,
        pendingNoteImages: entry.notesDraft.images,
      },
    }
  }

  private show(entry: Entry) {
    if (this.attached) this.listener.onShow(this.display(entry))
  }

  private send(caseId: string, entry: Entry) {
    const stored = valueOf(entry.confirmed)
    const value = { ...stored, ...entry.changes }
    const writeResult = !sameValue(value, stored)
    const draft = !writeResult && !entry.notesError ? entry.notesDraft : undefined
    entry.savingResult = writeResult ? entry.changes : undefined
    entry.changes = {}
    const images = draft?.images.filter(image => !entry.savedImages.has(image.id))
    const save = writeResult ? this.save(caseId, value) : draft && this.saveNotes?.(caseId, { notes: draft.notes, images: images ?? [] })
    if (!save) return

    entry.sending = true
    this.inFlight += 1
    void save.then((saved) => {
      entry.confirmed = saved
      for (const image of images ?? []) entry.savedImages.add(image.id)
      if (draft && entry.notesDraft === draft) entry.notesDraft = undefined
      const resultSettled = writeResult && sameValue({ ...valueOf(saved), ...entry.changes }, valueOf(saved))
      entry.savingResult = undefined
      entry.sending = false
      this.show(entry)
      if (resultSettled) this.listener.onSaved(caseId)
      this.send(caseId, entry)
      this.settled()
    }, (cause: unknown) => {
      entry.sending = false
      entry.savingResult = undefined
      if (writeResult) entry.changes = {}
      if (toCommandError(cause).kind === 'notFound') entry.notesDraft = undefined
      else if (draft && entry.notesDraft === draft) entry.notesError = formatError(cause)
      this.show(entry)
      if (!this.attached) this.listener.onBackgroundError(caseId, cause)
      else if (writeResult) this.listener.onError(caseId, cause)
      this.send(caseId, entry)
      this.settled()
    })
  }

  private settled() {
    this.inFlight -= 1
    if (this.inFlight > 0) return
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }
}

function valueOf(testCase: TestRunCase): CaseValue {
  return { result: testCase.result, remark: testCase.remark }
}
