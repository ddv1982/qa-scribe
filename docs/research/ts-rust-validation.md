# tsc-rs migration validation

This document records the historical v0.7.24 migration checkout. See [v0.8.12 release validation](ts-rust-release-validation.md) for current-main release evidence.

Validation date is 2026-10-20 on Linux x64. The branch is `migration/tsc-rs`, based on `3ba0a22`.

## The checker migration passes its local checks

`bun run frontend:compiler:check` passes twelve cases. One rejects a copied manifest reverted to JavaScript `tsc`. Seven exercise the installed compiler with valid TypeScript and TSX and deliberate TS2322 or TS2339 errors. Four exercise copied, actual package scripts in a disposable project. The valid build produces `dist/index.html`. Invalid UI and Vite configuration inputs fail with TS2322 before bundling.

`bun install --cwd frontend --frozen-lockfile` passes. The lockfile contains all six native optional platform packages at 0.7.0. Linux x64 executes locally. Existing CI checks Linux x64 and macOS arm64. Release builds also run the frontend on native Intel macOS. Those remote jobs have not run for this branch. Linux arm64 and Windows have no configured native execution gate.

`bun run frontend:check` passes both native project checks, typed ESLint, CSS checks, and contrast checks. The JavaScript TypeScript dependency remains installed for the lint API.

`bun run frontend:test` passes 316 tests in 42 files.

`bun run frontend:build` passes. `diff -qr artifacts/tsrust-research/baseline-dist frontend/dist` returns zero. Every production asset matches the pre-migration build byte for byte.

`bun run e2e:isolation` passes. The production bundle excludes the E2E bridge. `bash scripts/check-tauri-prebuilt-frontend.sh` passes its positive and deliberately invalid prebuilt-output cases.

## Rust and release checks preserve the existing behavior

`cargo test --workspace` passes 367 tests with two ignored tests. `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check` pass.

`bun run bindings:check` and `bun run tauri:commands:check` pass. Generated application bindings and command definitions remain unchanged.

`bun run release:check` passes release metadata, Linux package metadata tests, and 122 release script tests. Frontend dependency auditing reports no vulnerabilities at the requested high severity threshold. Terminology and source isolation checks also pass.

`cargo build --workspace` and `cargo run -p qa-scribe-app` pass. The smoke command initializes fresh SQLite storage through schema version 9. The clean built desktop E2E run passes all five workflows. They cover session lifecycle, manual testware, clipboard capture, generation cancellation, and summary recovery. Its receipt is `artifacts/tsrust-research/e2e-final/latest-run.json`.

## The first desktop run was invalidated and repeated

The first E2E run overlapped `cargo build --workspace`. Both Cargo variants write `target/debug/qa-scribe-tauri`. The production build replaced the E2E-enabled executable after the first scenario, and subsequent launches timed out waiting for embedded WebDriver. The owned test processes were stopped. The complete E2E command then rebuilt and ran without another Cargo writer. All five scenario exit codes are zero. The interrupted run is retained in `desktop-e2e-interrupted.log`.

## Existing review policies block aggregate verification

`bun run verify` fails in `rust:audit`. Ten advisory reviews and the advisory registry review expired on 2026-10-13. This failure occurs before downstream verification steps run.

`bun run verify:fast` fails in `code-size:check`. Exclusions for `scripts/build_apt_repository.py` and `scripts/validate_linux_package_metadata.py` expired on 2026-10-13.

The migration does not modify either policy or the Rust dependency graph. The individual checks above ran independently of the blocked aggregate commands. A full repository gate is not green. Renewing a review date requires reviewing its underlying exception, not extending the date to hide a failure.

## Evidence is available in the branch and locally

Small receipts are committed under `docs/research/ts-rust-evidence`. They record the compatibility replay, all 20 matching asset hashes, the five desktop scenario exit codes, and the twelve compiler checks. The canonical decision trail is committed at `docs/research/ts-rust-decisions.tsv`. Full command logs and the original baseline assets remain local.

Full receipts are saved under `artifacts/tsrust-research` with the command name in each filename. `compiler-probe.log`, `frontend-check.log`, `frontend-test.log`, `frontend-build.log`, `cargo-test.log`, `clippy.log`, and `bindings-check.log` contain successful runs. `verify.log`, `verify-fast.log`, `rust-audit.log`, and `code-size.log` contain the policy failures.

`asset-comparison.log` is empty because the recursive comparison found no differences. `asset-hashes.json` records matching SHA256 values for all 20 files and an explicit successful result. The baseline directory remains available for another comparison. Run `bun run frontend:compiler:check` to repeat compiler adoption checks without relying on saved logs.

The decision trail is `docs/research/ts-rust-decisions.tsv`. The independent Poteto investigator and implementation owner used the inherited Codex model. A separate Comment Sicko audit found no new code comments or suppressions. Claude Opus 5.5 reviewed the diff and decision trail. The review found no blocking application defect. Its compiler-ownership probe gap was fixed with an explicit command policy and a regression case. README now explains the editor and checker version difference. `compatibility-replay.json` saves six successful compiler/project checks, replayed after implementation against unchanged source/config inputs. The final Claude Opus 5.5 review confirmed that the fixes and saved receipts address its earlier findings. It found no blocking correctness defect. The final documentation records native platform limits and the interrupted desktop run.
