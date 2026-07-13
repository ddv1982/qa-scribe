# Rust Dependency Audit

Last reviewed: 2026-07-13 at v0.7.13. Next scheduled review: 2026-10-13, or earlier when a removal trigger below occurs.

## Gate

`bun run rust:audit` runs raw `cargo audit --json` against `Cargo.lock`, compares every finding with the exact reviewed registry in `scripts/rust-audit-exceptions.json`, and is wired into the shared CI/release validation action. A new vulnerability, unsoundness warning, unmaintained warning, or yanked crate fails the gate unless its advisory id and current package/version metadata already match that registry.

The quality target is zero unexplained or stale ignores. Zero total ignores is desirable, but upstream-constrained transitive advisories may remain when their exposure, blocker, and review trigger are current.

Every ignore must record:

- advisory classification and affected package/version;
- affected build target and application exposure;
- dependency path or upstream owner;
- patched version or replacement when one exists;
- why the compatible graph cannot use that fix today;
- review date and removal trigger.

## Current Registry

A raw `cargo audit --json` run on 2026-07-13 reports 20 reviewed advisories: 2 vulnerabilities, 1 unsoundness warning, and 17 unmaintained warnings.

### Vulnerabilities

| Advisories | Package | Exposure and blocker | Removal trigger |
| --- | --- | --- | --- |
| `RUSTSEC-2026-0194`, `RUSTSEC-2026-0195` | `quick-xml 0.39.4` | The remaining constrained path is `wayland-scanner`, used by the transitive Linux Wayland build stack. The advisories are patched in `quick-xml >=0.41.0`; the published Wayland dependency constraint does not currently permit it. | Remove when the Wayland/Tauri graph accepts `quick-xml >=0.41.0`; recheck on every Wayland, Tauri, or clipboard-plugin upgrade. |

### Unsoundness

| Advisory | Package | Exposure and blocker | Removal trigger |
| --- | --- | --- | --- |
| `RUSTSEC-2024-0429` | `glib 0.18.5` | Transitive Linux GTK3 runtime stack. The affected `VariantStrIter` implementation is patched in `glib >=0.20.0`, but Tauri's current Linux GTK3 graph remains on the 0.18 line. | Remove when the Tauri/Linux webview graph moves to a patched `glib`; recheck during every Tauri upgrade review. |

### Unmaintained GTK3 bindings

`RUSTSEC-2024-0411` through `RUSTSEC-2024-0420` cover `gdkwayland-sys`, `gdk`, `atk`, `gdkx11-sys`, `gtk`, `atk-sys`, `gdkx11`, `gdk-sys`, `gtk3-macros`, and `gtk-sys` 0.18.x. They are transitive Linux dependencies in Tauri's current GTK3 webview stack and have no patched GTK3 releases.

Removal trigger: upgrade the upstream Tauri/Linux webview stack away from the unmaintained GTK3 bindings. Recheck every Tauri release considered by the project and during the Phase 5 upgrade spike.

### Other unmaintained transitive packages

| Advisories | Packages | Exposure and blocker | Removal trigger |
| --- | --- | --- | --- |
| `RUSTSEC-2024-0370` | `proc-macro-error 1.0.4` | Transitive build/procedural-macro dependency; no maintained release in the same package line. | Remove when the owning upstream dependency migrates to a maintained diagnostic crate. |
| `RUSTSEC-2024-0436` | `paste 1.0.15` | Transitive macro dependency; the crate is unmaintained and has no patched release. | Remove when upstream stops depending on `paste` or adopts maintained equivalent code. |
| `RUSTSEC-2025-0075`, `RUSTSEC-2025-0080`, `RUSTSEC-2025-0081`, `RUSTSEC-2025-0098`, `RUSTSEC-2025-0100` | `unic-char-range`, `unic-common`, `unic-char-property`, `unic-ucd-version`, `unic-ucd-ident` 0.9.0 | Transitive Unicode stack with no maintained release in the same package family. | Remove when the upstream dependency migrates to maintained Unicode/ICU crates. |

The exact advisory-by-advisory inverse paths, target reachability, blockers, patched versions, and review triggers are enforced in `scripts/rust-audit-exceptions.json`; the tables above are the human-readable grouping.

## Phase 5 Upgrade Spike

The 2026-07-13 spike updated every compatible lockfile dependency first, including `anyhow 1.0.102 -> 1.0.103`, `tauri 2.11.3 -> 2.11.5`, and `tauri-runtime-wry 2.11.3 -> 2.11.4`. The `RUSTSEC-2026-0190` ignore was removed after the compatible `anyhow` fix.

The direct constrained packages were then checked against the current crates.io releases:

- `tauri 2.11.5`, `tauri-plugin-clipboard-manager 2.3.2`, `tauri-specta 2.0.0-rc.25`, and `wayland-scanner 0.31.10` are already the latest published versions used by this graph;
- `cargo tree --target x86_64-unknown-linux-gnu -i quick-xml@0.39.4` confirms the remaining path is clipboard manager → arboard → wl-clipboard-rs → Wayland protocols/scanner;
- `cargo tree --target x86_64-unknown-linux-gnu -i glib@0.18.5` confirms Tauri, wry, tao, and WebKit still converge on the GTK3 0.18 family even though newer standalone `glib` releases exist.

Therefore no compatible current Tauri/clipboard/Wayland upgrade removes the 20 retained findings. Re-run this spike when any direct version above changes or at the scheduled review date.

## Review Procedure

1. Run `cargo audit --json` without ignores and compare every advisory id and classification with this registry.
2. Run `cargo tree -i <package>@<version>` for each retained group to record the current inverse dependency path.
3. Apply compatible lockfile updates before considering an ignore.
4. Run a time-boxed Tauri, clipboard-plugin, Specta, GTK, and Wayland upgrade spike for graph-constrained items.
5. Remove resolved ids from `scripts/rust-audit-exceptions.json` and this document in the same change.
6. Run `bun run rust:audit`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, and the applicable package checks.
7. Update the review dates and evidence for every retained ignore.

At minimum, repeat this procedure quarterly and whenever upgrading Tauri, `tauri-plugin-clipboard-manager`, `tauri-specta`, Wayland, GTK, or the Linux webview stack.
