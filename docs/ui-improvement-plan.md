# UI Improvement Plan — Professional Visual Upgrade (Light + Dark)

Date: 2026-07-03
Status: Draft for review

## Goal

Make QA Scribe read as a polished, professional desktop tool in both light and dark mode — in the direction of Linear / Raycast / Stripe restraint — without changing the tech stack. We keep plain CSS + CSS variables, Lucide icons, and the existing `data-theme` mechanism. No Tailwind, no component library migration.

## Research summary (what separates "professional" from "assembled")

Findings from studying Linear, Raycast, Vercel, Stripe design-system teardowns and dark/light-mode token guides:

1. **Semantic token architecture is the foundation.** Components never reference raw colors; they reference role tokens (`--surface-raised`, `--text-secondary`, `--border-subtle`) that resolve differently per theme. This is the only approach that keeps two themes at equal quality.
2. **Dark mode is its own design, not an inversion.** Elevation in dark mode comes from *lighter surfaces* (a luminance ladder with 5–8% steps), not shadows. Borders go lighter than surfaces (`rgba(255,255,255,0.06–0.14)`); shadows are reserved for floating elements only. Accents need desaturated/lightened dark-mode variants.
3. **Restraint reads as premium.** One accent color, used on <10% of any view. Borders at ~6–10% opacity, not 15%. Surface steps you can feel but barely see. Hierarchy from subtraction, not decoration.
4. **No pure neutrals.** Never `#FFFFFF`/`#000000`/flat gray. Every neutral carries a trace of the brand hue (cool blue for us); shadows carry the same temperature. Light base ≈ blue-tinted off-white; dark base ≈ blue-tinted near-black; text off-white/near-black.
5. **Typography discipline: one family, tight scale.** Linear/Raycast/Vercel each use a single family (Inter/Geist) at 4–6 sizes, weights 400–600 only, body at 13–14px with 1.4–1.5 line-height and slight negative tracking on labels. Tabular numerals for counts.
6. **Interaction-state completeness is 60–80% of perceived polish.** Every interactive element needs default / hover / focus-visible / active / disabled (/ loading where async). Hover shifts of 5–10%, press `scale(0.98)`, instant focus rings, 150–300ms ease-out transitions, no `transition: all`.
7. **Spacing rhythm on a 4/8px grid.** Consistent scale beats generous-but-random spacing.

Key sources: Linear design-system teardowns (weight, borders at 6%, luminance stacking), Raycast token analyses (surface ladder #07080a→#121212, hairline borders, Inter ss03), dark-mode token guides (three-layer token architecture, contrast per pairing, halation avoidance), interaction-state coverage references (state matrix + motion durations).

## Current state (from codebase audit)

- Tokens live in `frontend/src/styles/base.css`: ~16 color variables with light + dark values — a good start, but they are *primitive-ish* (`--blue`, `--panel-bg`) rather than a full semantic set. Single `--radius: 8px`, single huge `--shadow: 0 22px 55px …` used broadly.
- Dark mode exists via `:root[data-theme="dark"]` + ThemeToggle (light/dark/system) — mechanism is right, values need redesign (dark shadows are near-invisible; no surface ladder; accents not re-tuned).
- Typography: system font stack; 11 ad-hoc font sizes (11–30px), weights 400/500/600/650/700/750, 8 ad-hoc line-heights. No scale.
- Spacing: ~16 ad-hoc values (3, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 34px). No scale.
- Hardcoded colors bypassing tokens: `editor.css:181` (`#d64545`), `shell.css:10`, `sidebar.css:190` (raw rgba borders).
- Interaction states: partial — no consistent focus-visible ring, hover coverage uneven, no motion tokens.
- Dead CSS: `record-card*`, `record-grid`, `model-selector`, `provider-hint` classes (also flagged in improvement-plan.md Phase 2).

## Design direction

**"Calm instrument."** A quiet, precise tool for QA note-taking: blue-tinted neutrals, one blue accent used sparingly, hairline borders, subtle depth, tight typography. Light mode = soft off-white with white raised cards and soft cool shadows. Dark mode = blue-tinted near-black with a luminance ladder and hairline light borders.

## Phases

### Phase 1 — Semantic token foundation (the biggest lever)

Restructure `base.css` into a semantic token set, both themes. Proposed roles (values to be tuned during implementation, all expressed in OKLCH for perceptual consistency; `color-mix()` for derived tints — both are Baseline/WebKit-safe):

- **Surfaces:** `--surface-base` (app background), `--surface-raised` (cards, panels, sidebar), `--surface-overlay` (menus, popovers, dialogs), `--surface-sunken` (input wells, code).
  - Light: base ≈ `#f6f8fb` (cool off-white), raised `#ffffff`, overlay `#ffffff`, sunken ≈ `#eef2f7`.
  - Dark ladder: base ≈ `#0e141b` → raised ≈ `#141b24` → overlay ≈ `#1a2330` (5–8% luminance steps, blue-tinted, never pure black).
- **Text:** `--text-primary`, `--text-secondary`, `--text-tertiary`. Dark primary is off-white ≈ `#e6ecf4` (not `#fff`), verified ≥ 4.5:1 on every surface it sits on.
- **Borders:** `--border-subtle` (hairlines ~6–8% opacity), `--border-default`, `--border-strong` (focus/hover emphasis). Dark borders are light-on-dark rgba, not darker grays.
- **Accent:** keep the blue identity. `--accent`, `--accent-hover`, `--accent-tint` (via `color-mix`), `--accent-text-on`. Dark variant slightly lighter/desaturated to avoid glare.
- **Status:** success / warning / danger / info, each with a `-tint` for soft backgrounds, re-tuned per theme.
- **Focus:** `--focus-ring` token (2px, accent-based, `outline-offset: 2px`), same treatment app-wide.
- **Depth:** `--shadow-sm/md/lg` as layered, cool-tinted stacks including a `0 0 0 1px` hairline layer (light mode); in dark mode shadows shrink and elevation moves to the surface ladder + borders. Retire the single 55px mega-shadow.
- **Shape:** `--radius-sm: 6px`, `--radius-md: 8px`, `--radius-lg: 12px`, `--radius-full`.

Then sweep all five CSS files to consume only semantic tokens; replace the three hardcoded color sites. Old token names get mapped or removed — no component references a raw value afterward.

### Phase 2 — Typography

- Bundle **Inter Variable** locally (e.g. `@fontsource-variable/inter`; local bundling matters for an offline desktop app), with `font-feature-settings: "cv01", "ss03"` and `tabular-nums` where counts/IDs render (badges, list counts).
- Type scale tokens: `--text-xs: 11px` (micro labels), `--text-sm: 12.5px` (labels), `--text-ui: 13.5px` (default UI/body), `--text-md: 15px` (editor body), `--text-lg: 18px` (section headings), `--text-xl: 24px` (note title — down from 30px). Line-height tokens: 1.25 (headings), 1.45 (UI), 1.6 (editor prose). `letter-spacing: -0.01em` on UI text and headings.
- Weights reduced to **400 / 500 / 600** (650 and 750 removed).
- Sweep all font-size/weight/line-height declarations onto the scale.

### Phase 3 — Spacing & layout rhythm

- Spacing tokens on a 4px grid: `--space-1: 4px` … `--space-8: 32px`. Sweep odd values (3, 7, 9, 14, 18, 22, 34) to the nearest step.
- Standardize control metrics: input/button heights 28px (compact) / 32px (default) / 36px (primary CTAs); consistent card padding (16/20px) and panel gutters.
- Slim the top bar from 86px toward ~60px — professional desktop tools keep chrome compact and give space to content. Re-balance the 272px rail spacing to the new grid.

### Phase 4 — Component state completeness & polish

For every interactive element, the full matrix: default / hover / focus-visible / active / disabled (+ loading where async):

- **Buttons (all 5 variants):** hover = 5–10% shift via `color-mix`; active = `transform: scale(0.98)` at 100ms; shared focus ring; disabled = reduced opacity + `cursor: not-allowed`, hover suppressed; loading = existing `Loader2` pattern standardized.
- **Inputs/selects/textareas:** hover border shift, `:focus` ring (inputs use `focus`, buttons use `focus-visible`), error state (border + tint + message) tokenized.
- **Sidebar rail:** distinct hover vs. active-item treatment (accent tint background + stronger text), consistent count-badge styling with tabular numerals.
- **Dialogs:** backdrop `rgba` + slight blur with fade-in; panel fade+scale-in (~200ms ease-out); `--surface-overlay` + `--shadow-lg`; consistent radius.
- **Rich-text toolbar & editor chrome:** align to sunken-surface + hairline treatment; selected-format state uses accent tint.
- **Empty states & status pills:** align to tint tokens; empty states get a quiet illustration/icon treatment rather than bare text.
- Delete the dead CSS classes (`record-card*`, `record-grid`, `model-selector`, `provider-hint`) during the sweep.

### Phase 5 — Motion & verification gate

- Motion tokens: `--duration-fast: 150ms`, `--duration-base: 200ms`, `--duration-slow: 300ms`, `--ease-out: cubic-bezier(0.2, 0, 0, 1)`. Explicit `transition-property` (never `all`). `prefers-reduced-motion` disables non-essential motion globally.
- **Verification (the gate for calling this done):**
  - Contrast check every text×surface and icon×surface pairing in *both* themes (≥4.5:1 body, ≥3:1 large text/UI/focus indicators). Check final rendered values, not intended alphas.
  - Guard against regression: a small lint/CI check that fails on raw hex/rgba color literals outside `base.css`.
  - Screenshot pass of every view (Sessions, Testware, Findings, Templates, Settings, dialogs, empty states) in both themes at 1x; squint test for hierarchy; side-by-side against a Linear/Raycast reference.
  - `bun run verify:fast` plus existing frontend tests stay green after each phase.

## Sequencing & scope notes

- Phases land in order; 1–3 are global sweeps (each one PR-sized), 4 can be split per component group, 5 is the closing gate.
- Phase 1 is the prerequisite for everything else; Phases 2–3 are mostly mechanical once scales exist.
- No component API changes, no new runtime dependencies except the bundled Inter font package.
- Terminology cleanup ("record"/"note"/"entry", improvement-plan.md Phase 4) is *out of scope* here — visual only.

## Alternatives considered

1. **Adopt Tailwind v4 + shadcn/ui** — strong theming defaults, but a full rewrite of every component's styling, new build deps, and it discards a working CSS architecture. Rejected: violates simplicity/DRY-with-what-exists.
2. **Radix primitives + keep CSS** — better a11y primitives for dialogs/comboboxes, but the custom ones already work and are tested. Deferred: could adopt selectively later if a11y gaps surface.
3. **Token + polish overhaul on the existing plain-CSS system (chosen)** — highest visual return per unit of risk; keeps the stack the team knows.
