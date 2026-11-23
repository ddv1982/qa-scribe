import type { TestCaseNoteImage, TestCaseNotes, TestCaseResult, TestRunCase } from '../tauri'
import { formatError } from '../ui/format'

/** What a tester sets on a test case. The store always takes both, so both are always sent. */
export type CaseValue = { result: TestCaseResult; remark: string | null }
type NotesDraft = { notes: TestCaseNotes; images: TestCaseNoteImage[] }
export type CasePatch = Partial<CaseValue> & { notesDraft?: NotesDraft }
export type EditableTestCase = TestRunCase & { notesSave?: 'saving' | 'failed'; notesError?: string }

type Entry = {
  /** What the store returned last. A failed save shows this again. */
  confirmed: TestRunCase
  /** `confirmed` with every change not yet saved applied in order: what the screen shows. */
  desired: CaseValue
  /** A status or notes write is in flight. */
  sending: boolean
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
    private readonly listener: CaseSaveListener,
    private readonly saveNotes?: (caseId: string, draft: NotesDraft) => Promise<TestRunCase>,
  ) {
    for (const testCase of cases) this.entries.set(testCase.id, { confirmed: testCase, desired: valueOf(testCase), sending: false })
  }

  has(caseId: string): boolean {
    return this.entries.has(caseId)
  }

  change(caseId: string, patch: CasePatch) {
    const entry = this.entries.get(caseId)
    if (!entry) return
    const { notesDraft, ...result } = patch
    entry.desired = { ...entry.desired, ...result }
    if (notesDraft) {
      entry.notesDraft = notesDraft
      entry.notesError = undefined
    }
    this.show(entry)
    if (!entry.sending) this.send(caseId, entry)
  }

  /** Stops showing changes; every change asked for still goes through. */
  detach() {
    this.attached = false
  }

  get idle(): boolean {
    return this.inFlight === 0
  }

  /** Resolves once no save is in flight or waiting, whether the last one succeeded or failed. */
  whenIdle(): Promise<void> {
    return this.idle ? Promise.resolve() : new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private show(entry: Entry) {
    if (!this.attached) return
    this.listener.onShow({
      ...entry.confirmed,
      ...entry.desired,
      ...entry.notesDraft && { notes: entry.notesDraft.notes, notesSave: entry.notesError ? 'failed' : 'saving', notesError: entry.notesError },
    })
  }

  private send(caseId: string, entry: Entry) {
    const value = entry.desired
    const writeResult = !sameValue(value, valueOf(entry.confirmed))
    const draft = !writeResult && !entry.notesError ? entry.notesDraft : undefined
    const save = writeResult ? this.save(caseId, value) : draft && this.saveNotes?.(caseId, draft)
    if (!save) return

    entry.sending = true
    this.inFlight += 1
    void save.then((saved) => {
      entry.confirmed = saved
      if (draft && entry.notesDraft === draft) entry.notesDraft = undefined
      const resultSettled = writeResult && sameValue(entry.desired, value)
      if (resultSettled) entry.desired = valueOf(saved)
      entry.sending = false
      this.show(entry)
      if (resultSettled) this.listener.onSaved(caseId)
      this.send(caseId, entry)
      this.settled()
    }, (cause: unknown) => {
      entry.sending = false
      if (writeResult) entry.desired = valueOf(entry.confirmed)
      else if (entry.notesDraft === draft) entry.notesError = formatError(cause)
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
