import { writeFileSync } from 'node:fs'
import WDIOReporter from '../frontend/node_modules/@wdio/reporter/build/index.js'

// Framework events, not console text or a zero process exit, attest execution.
export default class ExecutionReporter extends WDIOReporter {
  constructor(options) {
    super({ ...options, stdout: true })
    this.outcome = { version: 1, spec: process.env.QA_SCRIBE_E2E_SPEC, completed: false, passed: 0, failed: 0, skipped: 0 }
  }

  onTestPass() { this.outcome.passed += 1 }
  onTestFail() { this.outcome.failed += 1 }
  onTestSkip() { this.outcome.skipped += 1 }
  onRunnerEnd() {
    const path = process.env.QA_SCRIBE_E2E_EXECUTION_EVIDENCE
    if (!path) return
    this.outcome.completed = true
    writeFileSync(path, `${JSON.stringify(this.outcome)}\n`)
  }
}
