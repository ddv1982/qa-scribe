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
The minimal collection of Sessions a user can create, reopen, and save while working in qa-scribe.
_Avoid_: Project, Workspace

**Session Context**:
Optional product, feature, environment, build, ticket, URL, API, flow, objective, or notes that help explain what is being tested in a Session.
_Avoid_: Subject, System under test

**Objective Notes**:
Optional intent for a Session, describing what the tester is trying to learn, verify, or explore.
_Avoid_: Goal, Mission

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

**Session Report Draft**:
A Draft that summarizes a Session as structured Testware for review, editing, and reuse.
_Avoid_: Report, Summary

**Jira Bug Draft**:
A copy-ready bug report Draft shaped for manual creation of a Jira issue.
_Avoid_: Jira ticket, Jira issue
