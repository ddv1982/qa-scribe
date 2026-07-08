# Rust Dependency Audit

`bun run rust:audit` runs `cargo audit --deny warnings` against `Cargo.lock` and
is wired into the shared CI/release validation action. New RustSec
vulnerabilities, yanked crates, unmaintained warnings, or unsoundness warnings
fail the check unless the advisory is explicitly ignored below.

The audit currently ignores these transitive advisories:

- `RUSTSEC-2026-0194` and `RUSTSEC-2026-0195` for `quick-xml 0.39.x`: the
  remaining constrained path is `wayland-scanner`, a transitive Linux
  build-time scanner used through the Tauri/clipboard Wayland stack.
  `cargo update -p plist` lifts Tauri's plist path to `quick-xml 0.41.x`;
  `cargo update -p wayland-scanner` cannot currently lift the Wayland path
  within its published constraints.
- `RUSTSEC-2024-0411` through `RUSTSEC-2024-0420` and `RUSTSEC-2024-0429`:
  GTK3/glib advisories pulled in by Tauri's current Linux webview stack.
- `RUSTSEC-2024-0370`, `RUSTSEC-2024-0436`, `RUSTSEC-2025-0075`,
  `RUSTSEC-2025-0080`, `RUSTSEC-2025-0081`, `RUSTSEC-2025-0098`,
  `RUSTSEC-2025-0100`, and `RUSTSEC-2026-0190`: current transitive macro,
  Unicode, and error-handling warnings without an available compatible update
  in this dependency graph.

Remove ignores as soon as compatible upstream updates are available. At minimum,
re-check the list when upgrading Tauri, `tauri-plugin-clipboard-manager`,
`tauri-specta`, or the Linux Wayland/Gtk stack.
