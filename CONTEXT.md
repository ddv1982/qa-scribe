# qa-scribe

qa-scribe is a local-first testing notepad that helps testers collect raw testing material and turn it into structured testware.

## Implementation Direction

qa-scribe is implemented as a Rust/Tauri application rebuilt from the earlier Electrobun/Bun MVP. The product language below remains authoritative. Existing Electrobun/Bun app data is not a migration target.

## Language

**Session**:
A bounded testing effort for one feature, bug, build, ticket, release candidate, target, or objective. A Session contains the raw material captured during testing and the structured testware generated from it.
_Avoid_: Project, Notebook

**Entry**:
A raw item captured during a Session, such as a note, screenshot, log snippet, API response, observation, or possible finding.
_Avoid_: Artifact, Item

**Evidence**:
An Entry or part of an Entry that supports a generated testware item, bug report, finding, or conclusion.
_Avoid_: Proof, Attachment

**Finding**:
A structured conclusion drawn from one or more Entries, such as a bug, risk, passed check, failed check, open question, or follow-up action.
_Avoid_: Observation, Note

**Testware**:
The structured QA outputs generated or maintained from a Session, including summaries, scenarios, checks, Findings, and bug report drafts.
_Avoid_: Raw notes, Evidence

**Session Library**:
The minimal collection of Sessions a user can create, reopen, save, and delete while working in qa-scribe.
_Avoid_: Project, Workspace

**Session Context**:
Optional product, feature, environment, build, ticket, URL, API, flow, objective, or notes that help explain what is being tested in a Session.
_Avoid_: Subject, System under test

**Objective Notes**:
Optional intent for a Session, describing what the tester is trying to learn, verify, or explore. The Session sheet shows it as the Charter.
_Avoid_: Goal, Mission

**Session sheet**:
The optional plan and wrap-up of a Session: its Charter, a ticket or reference, its Acceptance criteria, a Timebox, and a Debrief. It is edited in one dialog, and an empty sheet shows nothing beyond its header button.
_Avoid_: Session form, Session metadata

**Charter**:
The UI label for Objective Notes in the Session sheet: one statement of what the Session explores and what it hopes to find, such as "Explore checkout to find payment failures".
_Avoid_: Mission, Goal

**Timebox**:
The planned length of a Session, in whole minutes from 1 to 1440. QA Scribe records it and does not run a timer.
_Avoid_: Deadline, Duration

**Debrief**:
The tester's wrap-up of a Session in the Session sheet: notes on what was covered, what is left, and what got in the way, plus an optional time split across testing, bug investigation and setup that adds up to 100.
_Avoid_: Retrospective, Report

**Acceptance criteria**:
The optional test basis of a Session in the Session sheet: plain text, one criterion per line, each starting with an id such as `AC-1` or `SHOP-412`. Lines saved without an id are numbered `AC-1`, `AC-2`, and so on. A criterion id written in a test case is the link between the two; there is no other traceability record.
_Avoid_: Requirements, User stories

**Coverage line**:
One quiet line above a Session's Test cases that counts the acceptance criteria its saved Test cases drafts name by id, and lists the ones none does yet. It appears only when the Session has acceptance criteria, and unsaved edits count only once they are saved.
_Avoid_: Traceability matrix, Coverage report

**Session Timeline**:
The chronological stream of Entries captured during a Session.
_Avoid_: Feed, Log

**Note**:
A freeform Entry that records tester context, thoughts, setup details, reminders, or copied text without requiring interpretation.
_Avoid_: Comment, Memo

**Observation**:
An Entry that records behavior noticed about the tested product, flow, or context during a Session.
_Avoid_: Finding, Note

**API Response**:
An Entry that records an HTTP response observed during testing, optionally including request metadata.
_Avoid_: Payload, JSON

**Log**:
An Entry that records runtime, browser, server, console, or system output observed during testing.
_Avoid_: Trace, Output

**Generation Context**:
The subset of Session data selected for an AI generation request.
_Avoid_: Prompt input, Context window

**Draft**:
Editable Testware created from a Session, often with AI assistance and then revised by the user.
_Avoid_: AI output, Result

**AI Run**:
An immutable record of an AI generation request and its response metadata.
_Avoid_: Completion, Inference

**Test case**:
One case in a Test cases draft, and the unit a Test run copies. How a draft splits into test cases depends on its output format: a heading per case for QA cases and Gherkin, a list item per check for a checklist. Charters and coverage outlines have no test cases to run.
_Avoid_: Test, Check, Step

**Test run**:
A frozen copy of a saved Test cases draft's test cases, made when the tester chooses Start test run, with a Result and an optional Remark per test case. Editing the draft later does not change it, Ask AI is not offered on it, and deleting the draft deletes its test runs. The UI always says "test run", never "run" alone, because an AI Run is something else.
_Avoid_: Run, Execution, Test cycle

**Result**:
The outcome a tester records for one test case in a Test run: passed, failed, blocked or not run. Only the tester sets it; AI never does.
_Avoid_: Status, Verdict, Outcome

**Remark**:
An optional plain note a tester adds to one test case's Result in a Test run, such as why it was blocked.
_Avoid_: Comment, Note

**Session Report Draft**:
A Draft that summarizes a Session as structured Testware for review, editing, and reuse.
_Avoid_: Report, Summary

**Jira Bug Draft**:
A copy-ready bug report Draft shaped for manual creation of a Jira issue.
_Avoid_: Jira ticket, Jira issue

**Ask AI**:
The action that opens a fresh conversation beside a saved Finding or Test cases draft. The conversation belongs to that record. Reclicking an open panel focuses its current input. A settled close and reopen starts fresh. Exact unfinished turns and prepared edits remain recoverable through their original references. Sending includes that record's current content without saving its edits.

**AI chat**:
Notes chat and record Ask AI use separate conversations, input, images, and tool decisions. Close persists input before hiding, and keeps the panel visible if persistence fails. The provider and model preference applies globally to the next invocation through Notes and Settings. Only Notes chat can be added to the Session Note.

**Refinement proposal**:
A suggested change reviewed in Ask AI. Update finding or Update test case saves the proposal and its completion in one transaction. It rejects a changed saved record, and retrying the same proposal never writes it twice. Legacy Notes suggestions can still be applied to the editor and saved normally.

**Jira conversation draft**:
Jira content and follow-up answers in AI chat. The configured coding agent handles Jira tools and actions. This is separate from the clipboard-only Jira Bug Draft and does not introduce a stored Draft kind.

**Record**:
A UI umbrella term for a Draft or Finding rendered and edited through the shared rich-record components.
_Avoid_: Item, Card
