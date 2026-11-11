# Docs archive

This folder holds finished plans and the evidence behind them. Nothing here describes the system as it is today. For that, start with [architecture](../architecture.md) and [development](../development.md).

Every plan below shipped, and the release column says where. Many still show open boxes: those are steps that were done through PRs, or release steps, that were never ticked. The few real leftovers are in [backlog](../backlog.md). The relative layout matches the old `docs/` layout, so links between archived files still work.

Classification done 2026-11-11 (project health plan, P2).

## Plans

| File | Status | Shipped in |
| --- | --- | --- |
| action-bar-composer-polish-plan.md | done | v0.8.34 |
| adoption-and-ci-improvement-plan.md | done; boxes not ticked | v0.8.17, v0.8.18 (PR #72 to #75) |
| ask-ai-conversation-isolation-plan.md | done; later steps replaced by the UX reset | v0.8.23 |
| ask-ai-minimal-implementation-plan.md | done | v0.8.23, v0.8.24 |
| ask-ai-phased-plan.md | done; superseded by design/ask-ai/implementation.md | v0.8.22 |
| ask-ai-ux-reset-plan.md | done; superseded by the minimal plan | v0.8.23 |
| chat-permission-v0.8.3-plan.md | done | v0.8.3 |
| chat-tool-authorization-plan.md | done | v0.8.4 to v0.8.6 |
| chat-tools-plan.md | done | v0.8.1 |
| ci-release-simplification.md | done (phase 3 rehearsal moved to backlog) | v0.8.27, v0.8.29, v0.8.32 |
| claude-copilot-model-detection-plan.md | done | see provider-catalog-contract.md |
| cli-model-management-plan.md | done; boxes not ticked (external gate moved to backlog) | v0.8.10 (PR #47 to #50) |
| codebase-improvement-plan-2026-10-04.md | done | v0.7.22 |
| codebase-remediation-plan-2026-07-20.md | done | v0.7.21 |
| default-cli-config-and-ux-overhaul-plan.md | done (user benchmark not run) | ADR 0010 |
| design-consistency-plan.md | done | v0.8.33 |
| generation-preflight-layout-plan.md | done | v0.8.x |
| improvement-plan.md | done | v0.4.24 |
| maintainability-program-plan.md | done; boxes not ticked | v0.8.9 (PR #40 to #45) |
| manual-formats-chat-attachments-plan.md | done; superseded by the implementation record | v0.8.21 |
| manual-formats-chat-attachments-implementation.md | done | v0.8.21 |
| markdown-formatting-plan.md | done | v0.8.x |
| notes-ask-ai-plan.md | done | v0.8.25 |
| notes-ask-ai-unified-plan.md | done | v0.8.35 |
| refactoring-roadmap.md | phases 1 to 5 done; phase 6 folded into the health plan P1 | v0.8.x |
| release-v0.7.23-plan.md, release-v0.7.24-plan.md | done | v0.7.23, v0.7.24 |
| release-v0.8.12-plan.md, release-v0.8.13-plan.md | done | v0.8.12, v0.8.13 |
| rust-rebuild-plan.md | done | ADR 0009 |
| session-chat-plan.md | done | v0.8.0 |
| sidebar-preflight-ui-plan.md | done | v0.8.7 |
| testware-rendering-parity-plan.md | done | v0.8.8 |
| testware-streamdown-plan.md | done | v0.8.5 |
| tsc-rs-only-plan.md | done; boxes not ticked | v0.8.15 |
| ts-rust-migration-plan.md | done | v0.8.12 |
| typescript-7-native-tooling-plan.md | done (deferred performance study dropped) | v0.8.14 |
| ui-improvement-plan.md | done | v0.6.0 |
| ui-polish-plan.md | done | v0.6.x |
| ux-workflow-improvement-plan.md | done | v0.8.16 (PR #66 to #70) |

## Evidence

| Path | Contents |
| --- | --- |
| codebase-audit-2026-07-20.*, codebase-audit-validation-2026-07-20.md, codebase-review-2026-10-04.md, code-quality-baseline.md | audits behind the v0.7.x remediation |
| startup-performance-review.md, ui-inventory-target-states.md | July 2026 measurements and UI inventory |
| design/ | Ask AI, conversations, minimal Ask AI, manual formats and UI redesign mockups and verification receipts |
| investigations/ | October 2026 inputs to the CLI model and maintainability plans |
| research/ | TypeScript native tooling (tsc-rs, TypeScript 7) evaluations |
| superpowers/ | July 2026 UI upgrade and editor conversion plans and specs |
| verification/ | CLI model management and maintainability execution records |
