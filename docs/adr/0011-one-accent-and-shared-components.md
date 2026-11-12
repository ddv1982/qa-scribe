# ADR 0011: One accent colour and a shared component set

**Status:** Accepted

**Date:** 2026-11-12

## Context

The interface had no colour of its own. The accent was near-black in light mode
and near-white in dark mode, so focus rings and selected states read as stray
white boxes in dark mode. Screens also drifted apart, because only the button
was a shared control. Fields, tabs, badges and empty states were restyled per
screen, across 4,000 lines of CSS and about 240 one-off class names.

## Decision

1. **Accent.** The accent is teal-green: `#0f6e5c` in light mode and `#5fd0b4`
   in dark mode. It marks the main action, links, keyboard focus and the
   focused border of a text field. Green, amber and red stay reserved for
   results and severity. The app mark keeps its ink square.
2. **Shared components.** Screens are built from the components listed in
   [the UI standard](../design/ui-standard.md). They live in
   `frontend/src/components`, and their styles live in `frontend/src/styles`,
   where the colour and contrast checks already look.
3. **No behaviour library for now.** Dialogs keep the native `<dialog>` element
   with `useModalDialog`, which already gives focus trapping and Escape.
   Selects stay native. Base UI 1.9 was tried in the macOS app: its dialog and
   menu worked, but its select would not pick an item in the test run, and the
   native elements need no dependency. Revisit this when the app needs a menu
   that a native element cannot provide.
4. **One pattern per pull request.** A shared component lands together with
   the screens that move onto it and the CSS it replaces. No component is added
   before it has a caller.

## Consequences

- A new screen should need no new control CSS.
- Primary buttons are teal instead of ink, so a screen should show at most one.
- End-to-end tests that find elements by class name must move to roles and
  labels as each screen migrates.
