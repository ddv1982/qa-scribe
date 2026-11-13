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
  /** The case as the screen should show it now. */
  onShow: (testCase: TestRunCase) => void
  /** Every change of the case is stored. */
  onSaved: (caseId: string) => void
  /** A save failed; the case shows its stored value again and its unsaved changes are dropped. */
  onError: (caseId: string, cause: unknown) => void
}

const sameValue = (left: CaseValue, right: CaseValue) => left.result === right.result && left.remark === right.remark

/**
 * Saves the changes of one test run's cases. Per case at most one save is in flight; changes made
 * meanwhile are merged and the latest value is sent when it settles, so an older save can never land
 * after a newer one. Different cases save independently. After `dispose`, nothing is reported.
 */
export class CaseSaveQueue {
  private readonly entries = new Map<string, Entry>()
  private disposed = false

  constructor(
    cases: TestRunCase[],
    private readonly save: (caseId: string, value: CaseValue) => Promise<TestRunCase>,
    private readonly listener: CaseSaveListener,
  ) {
    for (const testCase of cases) this.entries.set(testCase.id, { confirmed: testCase, desired: valueOf(testCase), sending: null })
  }

  change(caseId: string, patch: CasePatch) {
    const entry = this.entries.get(caseId)
    if (!entry || this.disposed) return
    entry.desired = { ...entry.desired, ...patch }
    this.listener.onShow({ ...entry.confirmed, ...entry.desired })
    if (!entry.sending) this.send(caseId, entry)
  }

  dispose() {
    this.disposed = true
  }

  private send(caseId: string, entry: Entry) {
    const value = entry.desired
    entry.sending = value
    this.save(caseId, value).then((saved) => {
      if (this.disposed) return
      entry.confirmed = saved
      entry.sending = null
      if (!sameValue(entry.desired, value)) {
        this.send(caseId, entry)
        return
      }
      entry.desired = valueOf(saved)
      this.listener.onShow(saved)
      this.listener.onSaved(caseId)
    }, (cause: unknown) => {
      if (this.disposed) return
      entry.sending = null
      entry.desired = valueOf(entry.confirmed)
      this.listener.onShow(entry.confirmed)
      this.listener.onError(caseId, cause)
    })
  }
}

function valueOf(testCase: TestRunCase): CaseValue {
  return { result: testCase.result, remark: testCase.remark }
}
