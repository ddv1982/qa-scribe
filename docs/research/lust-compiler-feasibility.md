# Lust compiler feasibility

Researched on 2026-10-28, before planning a migration. **Result: defer adoption.**
Lust cannot currently compile the qa-scribe workspace or replace its release
compiler. No application code, dependencies, compiler settings, or CI gates
were migrated. The [phased plan](../lust-adoption-plan.md) records the gates for
reconsidering it.

## Research method and sources

Exa search and fetch located and read the upstream repository. Ref search did
not locate relevant Lust documentation, so Ref URL reads checked the upstream
README and plan directly. GitHub API reads confirmed the source revision,
latest release, release assets, and adapter directory. Local source inspection
and `cargo metadata --no-deps --locked --offline --format-version 1` identified
our workspace targets and direct dependencies.

The inspected upstream `next` revision was
[`240e08d91d4aed0299639f6f11fd522912b248f9`](https://github.com/t3dotgg/lust-lang/tree/240e08d91d4aed0299639f6f11fd522912b248f9).
The latest published release was
[`v0.2.0`](https://github.com/t3dotgg/lust-lang/releases/tag/v0.2.0), published
2026-10-17. Source inspection and a published binary are distinct evidence:
this investigation did not execute either Lust compiler binary.

Primary references at the inspected revision:

- [README: current support, platform requirements, commands, and measurements](https://github.com/t3dotgg/lust-lang/blob/240e08d91d4aed0299639f6f11fd522912b248f9/README.md).
- [Plan: intended scope and deliberate exclusions](https://github.com/t3dotgg/lust-lang/blob/240e08d91d4aed0299639f6f11fd522912b248f9/docs/PLAN.md).
- [Dependency adapters](https://github.com/t3dotgg/lust-lang/tree/240e08d91d4aed0299639f6f11fd522912b248f9/library/deps).

Use the README for implemented behavior. Upstream explicitly describes parts
of its design and architecture documents as plans. Search also returned a
different Lua-inspired language at `lust-lang.dev`; that is not the compiler
in `t3dotgg/lust-lang` and was excluded.

## What Lust provides

Lust accepts a subset of Rust 2024 and aims to match rustc behavior for accepted
programs. A resident daemon accelerates small edits. Development builds emit C
and use TinyCC. Cargo still supplies workspace metadata, while release builds
delegate to Cargo/rustc. Installing Lust therefore does not remove the Rust
toolchain requirement.

The published package targets Linux x86_64, requires glibc 2.38 or newer and C
development files, and includes its runtime and dependency adapters. Upstream
does not verify other platforms. Its development command interface takes a
source file and target selection; no upstream-supported drop-in `RUSTC=lust`
integration was established by this research.

Upstream's strongest performance results concern warm, small edits in its
adapted ts-rust project. They establish no speedup for qa-scribe. It also reports
slower generated development programs, so a future experiment must measure
the full check/build/test loop as well as compiler latency.

## Workspace blockers

These are source-based incompatibilities, not observed Lust diagnostics. Error
codes below are upstream's documented rejects. The examples are sufficient to
block adoption; this is not an exhaustive syntax or transitive dependency scan.

| Boundary | Local evidence | Upstream limitation and consequence |
| --- | --- | --- |
| Core serialization and typed bridge | [Core status type](../../crates/qa-scribe-core/src/lib.rs) derives Serde traits; [chat commands](../../src-tauri/src/commands/chat.rs) also derive `specta::Type`. | Non-builtin derives/procedural macros are rejected (`L0403`), by design. Removing them would require replacing real serialization and bridge behavior. |
| Core errors | [Error type](../../crates/qa-scribe-core/src/error.rs) derives `thiserror::Error`. | Another non-builtin derive; core already exceeds the subset without the desktop shell. |
| Dependencies and storage | [Core manifest](../../crates/qa-scribe-core/Cargo.toml) requires `rusqlite`, `serde`, `serde_json`, `specta`, `image`, and other registry crates. | None of the core's direct registry dependencies has a named adapter in the inspected directory. Dependencies without an adapter are rejected (`L0508`); reading Cargo metadata does not imply compiling these crates. Bundled SQLite also needs native integration. |
| Desktop command surface | [Chat commands](../../src-tauri/src/commands/chat.rs) use `#[tauri::command]`; [desktop main](../../src-tauri/src/main.rs) uses `tauri::generate_context!`. | Tauri relies on procedural macros and has no adapter. This requires an integration strategy, not a toolchain pin change. |
| Async desktop work | `save_chat_composer`, `import_chat_image`, and `start_chat_job` in the chat command module are async functions. | Async syntax is rejected (`L0405`); general async executors are outside the upstream plan. |
| Native process handling | [Process I/O](../../src-tauri/src/process_io.rs) calls `libc::killpg` in unsafe code. | Unsafe source is rejected (`L0404`). A supported native boundary with equivalent process cleanup would be needed. |
| Supported hosts | [CI](../../.github/workflows/ci.yml) covers Linux x64 and macOS arm64 with Intel cross-checking; [releases](../../.github/workflows/release.yml) ship both macOS architectures. | Linux-only verification cannot establish compatibility for the supported macOS builds. |
| Compiler removal | [Toolchain](../../rust-toolchain.toml), [shared setup](../../.github/actions/setup-project/action.yml), and [validation](../../.github/actions/validate-build/action.yml) use Rust, Clippy, rustfmt, and Cargo. | Lust still uses rustc for releases. Complete removal of rustc is outside the current upstream design. |

The workspace has three packages. `qa-scribe-core` is blocked directly;
`qa-scribe-app` depends on that core and `serde_json`; `qa-scribe-tauri` adds
the desktop blockers. None is an immediately compatible independent target.
Already using the prebuilt `tsc-rs` npm package for TypeScript does not imply
our Rust application can use the compiler that develops ts-rust.

## Evidence and limits

The metadata command succeeded on the existing Rust 1.99.1/edition 2024
workspace without modifying manifests or the lockfile. Source and adapter
inspection established the blockers above. No open Dependabot PRs existed at
the start of this investigation.

The research host was macOS arm64. Docker was installed, but its daemon socket
was unavailable. No Linux Lust execution, daemon measurement, runtime parity
test, or qa-scribe speedup was observed. A source build on this Mac would not
establish support for the upstream Linux release. The present result is a
documented feasibility decision, not a failed compiler benchmark or a completed
migration.
