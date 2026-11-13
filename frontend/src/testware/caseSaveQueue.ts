import type { TestCaseResult, TestRunCase } from '../tauri'

/** What a tester sets on a test case. The store always takes both, so both are always sent. */
export type CaseValue = { result: TestCaseResult; remark: string | null }
export type CasePatch = Partial<CaseValue>

type Entry = {
  /** What the store returned last. A failed save shows this again. */
  confirmed: TestRunCase
  /** `confirmed` with every change not yet saved applied in order: what the screen shows. */
  desired: CaseValue
  /** The value being saved, or null when nothing is in flight. */
  sending: CaseValue | null
}

export type CaseSaveListener = {
  /** The case as the screen should show it now. Not called once detached. */
  onShow: (testCase: TestRunCase) => void
  /** Every change of the case is stored. Also called once detached. */
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
 * takes no new changes and shows nothing, but keeps saving until it is idle.
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
  ) {
    for (const testCase of cases) this.entries.set(testCase.id, { confirmed: testCase, desired: valueOf(testCase), sending: null })
  }

  change(caseId: string, patch: CasePatch) {
    const entry = this.entries.get(caseId)
    if (!entry || !this.attached) return
    entry.desired = { ...entry.desired, ...patch }
    this.listener.onShow({ ...entry.confirmed, ...entry.desired })
    if (!entry.sending) this.send(caseId, entry)
  }

  /** Stops taking changes and showing them; saves already asked for still go through. */
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

  private send(caseId: string, entry: Entry) {
    const value = entry.desired
    entry.sending = value
    this.inFlight += 1
    this.save(caseId, value).then((saved) => {
      entry.confirmed = saved
      entry.sending = null
      if (!sameValue(entry.desired, value)) {
        this.send(caseId, entry)
      } else {
        entry.desired = valueOf(saved)
        if (this.attached) this.listener.onShow(saved)
        this.listener.onSaved(caseId)
      }
      this.settled()
    }, (cause: unknown) => {
      entry.sending = null
      entry.desired = valueOf(entry.confirmed)
      if (this.attached) {
        this.listener.onShow(entry.confirmed)
        this.listener.onError(caseId, cause)
      } else {
        this.listener.onBackgroundError(caseId, cause)
      }
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
