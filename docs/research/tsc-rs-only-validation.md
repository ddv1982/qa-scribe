# Rust compiler and editor SDK validation

The original migration used `tsc-rs` 0.7.0; the current pin is 0.8.0 for frontend type checks and editor language features. Its executable reports TypeScript language version `7.1.0-dev`. The frontend dependency graph excludes the separate Microsoft compiler SDK and its platform packages.

The Microsoft TypeScript 7 VS Code extension remains the editor client. Oxlint and its Go-based typed engine remain responsible for lint rules. Vite still bundles the frontend. This change does not replace application code or every tool with Rust.

## Installation and ownership

A frozen frontend install runs the SDK preparation command. The command resolves the installed host package, validates its identity and standard libraries, and creates a relative `.tsc-rs-sdk` link inside the local installation. It preserves vendor files and workspace settings. The explicit repair command is documented in [Development](../development.md).

The supported installation hosts are Linux x64, macOS ARM64, and macOS x64. The editor guard checks both direct folder layouts without repairing their setup. Native CI verifies cold and restored-cache installations on all three hosts. Its ARM64 macOS job additionally drives the actual desktop editor.

## Local editor evidence

The SDK-absent Linux candidate exercised completion, hover, definition navigation, accepted imports, cross-file rename, UI and Vite diagnostics, typed lint, repair, reload, SDK-link repair, and repeated edits. Both layouts used the pinned Rust executable. The parent checked source bindings and artifact hashes while the original handoff was available.

Independent OpenAI review accepted the bounded candidate evidence and a qualified baseline reference. Original baseline failures remain failures. They concerned a Vite input action that accumulated indentation, a resolution counted after cleanup began, and an overlong disposable IPC path. The corrected reference preserves completed cycles and the unchanged response deadline. It does not establish an unqualified pass of the original procedure.

The initial macOS ARM64 feasibility run passed actual Trust and SDK approval, completion, compiler and typed-lint diagnostic repair, reload, and Rust executable identity in both folder layouts. Final SDK-absent checks run through the same native CI workflow. Intel macOS installation and compiler coverage is separate from ARM64 editor evidence.

## Native protocol qualification

The installation probe checks ordered initialization, shutdown acknowledgment, exit transmission, and process termination. It preserves protocol and stream errors after initialization and rejects unexpected exits.

The 0.8.0 upgrade reproduced the same shutdown qualification previously observed with 0.7.0 on macOS ARM64. After acknowledging shutdown and receiving exit, it can emit `error handling method 'exit': EOF`, write `context canceled`, and return code 1. The probe accepts only that exact signature from the pinned 0.8.0 SDK as `QUALIFIED_PINNED_0_8_0_SHUTDOWN_EOF`. It records the actual code and does not call it normal termination. Other failures remain errors. Focused fake-peer cases cover these rejection paths.

This requested-shutdown outcome is separate from the active editor's crash and restart checks.

## Evidence and limits

The [implementation PR](https://github.com/ddv1982/qa-scribe/pull/65) records current source checks, hosted results, review, and release readiness. Several original temporary evidence directories subsequently disappeared for an undetermined reason. Their review reports and parent checks remain recorded, but the original raw editor artifacts are no longer available for inspection. Final acceptance therefore requires fresh editor proof at the release candidate. New receipts are retained in workspace artifacts rather than product assets.

The original Intel warm-install test failure at `0748613` occurred while observing initial Chat readiness. A fresh run at `8da800d` passed all nine attached checks without application or test-timing changes. The original failure remains preserved, and its exact cause is unproven.

This migration makes no claim of faster CI, faster application startup, performance equivalence, a memory bound, or long-session editor stability. Upstream lists editor memory growth among the [pinned release's known problems](https://github.com/pingdotgg/ts-rust/blob/3644f3244d9a93082c69e6691e8b280a0ccc98d0/npm/tsc-rs-readme.md#known-problems). Cleanup receipts establish that recorded process identities stopped. They do not establish complete discovery of every possible descendant.
