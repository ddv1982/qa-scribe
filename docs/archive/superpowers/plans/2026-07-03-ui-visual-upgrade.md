# UI Visual Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild QA Scribe's visual layer on semantic design tokens so both light and dark mode read as a polished professional desktop tool (spec: `docs/ui-improvement-plan.md`).

**Architecture:** Pure CSS refactor plus one font package. A new semantic token set in `base.css` (surfaces, text, borders, accent, status, shadows, radius, type/spacing/motion scales) replaces the current primitive-ish tokens; every other CSS file is swept to consume only semantic tokens. Two Node scripts become permanent CI gates: one forbids raw color literals outside `base.css`, one checks WCAG contrast of token pairings in both themes. No component API changes; TSX files are untouched except where noted.

**Tech Stack:** React 19 + Vite 7 (frontend/), plain CSS with custom properties, `data-theme` attribute theming, Bun 1.3.5, Vitest. New dependency: `@fontsource-variable/inter` only.

## Global Constraints

- All commands run from `frontend/` unless stated otherwise; package manager is **bun** (never npm/yarn).
- No new runtime dependencies except `@fontsource-variable/inter`.
- No Tailwind, no component library, no CSS-in-JS — plain CSS + custom properties only.
- Components may only consume **semantic** tokens; raw color literals are allowed **only** in `src/styles/base.css`.
- Derived colors use `color-mix(in oklab, …)`; both `color-mix()` and OKLCH are supported by Tauri's WebKit — no fallbacks needed. (Refinement vs. spec: base values are authored as hex for reviewability; perceptual mixing happens via `in oklab`.)
- Font weights used anywhere: 400, 500, 600 only. Font sizes only from the `--font-size-*` scale. Gap/padding/margin only from the `--space-*` scale (1px/2px micro-values exempt; widths/heights of content boxes exempt).
- `frontend: bun run check && bun run test` must pass after every task; each task ends with a commit.
- Commit messages follow repo style (`feat(frontend): …`, `refactor(frontend): …`) and end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Verification harness (color-literal gate + contrast gate)

**Files:**
- Create: `frontend/scripts/check-css-colors.mjs`
- Create: `frontend/scripts/check-contrast.mjs`
- Modify: `frontend/package.json` (add `lint:css` and `check:contrast` scripts — NOT yet added to `check`)

**Interfaces:**
- Produces: `bun run lint:css` (exit 1 while raw literals exist outside base.css — red until Task 4), `bun run check:contrast` (exit 1 until Task 2 defines the semantic tokens it checks). Task 9 wires both into `check`.

- [ ] **Step 1: Write the color-literal checker**

`frontend/scripts/check-css-colors.mjs`:

```js
#!/usr/bin/env node
// Gate: raw color literals may only live in src/styles/base.css.
// Everything else must consume semantic tokens (var(--...)).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const stylesDir = fileURLToPath(new URL('../src/styles', import.meta.url));
const ALLOWED = new Set(['base.css']);
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\boklab\(/;

const violations = [];
for (const file of readdirSync(stylesDir).sort()) {
  if (!file.endsWith('.css') || ALLOWED.has(file)) continue;
  readFileSync(join(stylesDir, file), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (COLOR_LITERAL.test(line)) violations.push(`${file}:${i + 1}: ${line.trim()}`);
    });
}

if (violations.length > 0) {
  console.error(`Raw color literals outside base.css (${violations.length}):`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log('css colors: OK — all color literals confined to base.css');
```

Note: `color-mix(in oklab, var(--x) 88%, #000)` in base.css is fine; in other files `color-mix()` calls may only reference `var(--…)` and `transparent`/`black`-free — the regex enforces this because any hex/rgb literal inside the call matches. The CSS keyword `transparent` is allowed everywhere (no literal syntax).

- [ ] **Step 2: Write the contrast checker**

`frontend/scripts/check-contrast.mjs`:

```js
#!/usr/bin/env node
// Gate: WCAG contrast for token pairings, both themes, parsed from base.css.
// Pairs resolving to color-mix() are skipped (backgrounds tuned visually).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  fileURLToPath(new URL('../src/styles/base.css', import.meta.url)),
  'utf8',
);

function declsFor(selectorPattern) {
  const decls = {};
  const blockRe = new RegExp(String.raw`(^|\n)\s*${selectorPattern}\s*\{([^}]*)\}`, 'g');
  for (const block of css.matchAll(blockRe)) {
    for (const d of block[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      decls[d[1]] = d[2].trim();
    }
  }
  return decls;
}

const light = declsFor(String.raw`:root`);
const dark = { ...light, ...declsFor(String.raw`:root\[data-theme="dark"\]`) };

function resolve(value, theme, depth = 0) {
  if (depth > 10) throw new Error(`var() recursion resolving: ${value}`);
  const m = value.match(/^var\(--([\w-]+)\)$/);
  if (m) return resolve(theme[m[1]] ?? '', theme, depth + 1);
  return value;
}

function parseColor(value) {
  if (value.includes('color-mix')) return null; // skipped pair
  let m = value.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error(`Unparseable color: "${value}"`);
}

const compositeOver = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

function luminance({ r, g, b }) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [foreground token, background token, minimum ratio]
const PAIRS = [
  ['text-primary', 'surface-base', 4.5],
  ['text-primary', 'surface-panel', 4.5],
  ['text-primary', 'surface-raised', 4.5],
  ['text-primary', 'surface-sunken', 4.5],
  ['text-primary', 'surface-overlay', 4.5],
  ['text-secondary', 'surface-base', 4.5],
  ['text-secondary', 'surface-panel', 4.5],
  ['text-secondary', 'surface-raised', 4.5],
  ['text-secondary', 'surface-sunken', 4.5],
  ['text-secondary', 'surface-overlay', 4.5],
  ['text-tertiary', 'surface-raised', 3.0], // placeholders/disabled only
  ['accent', 'surface-raised', 4.5], // accent-as-text (rail counts, eyebrows)
  ['accent', 'surface-panel', 4.5],
  ['accent', 'surface-sunken', 4.5],
  ['accent', 'surface-base', 3.0], // focus ring vs page background
  ['accent-alt', 'surface-raised', 4.5],
  ['success', 'surface-raised', 4.5],
  ['warning', 'surface-raised', 4.5],
  ['danger', 'surface-raised', 4.5],
  ['danger', 'surface-sunken', 4.5], // error text on input wells
  ['on-accent', 'accent', 4.5],
  ['on-accent', 'success', 4.5],
  ['on-accent', 'danger', 4.5],
];

let failures = 0;
let skipped = 0;
for (const [themeName, theme] of [['light', light], ['dark', dark]]) {
  for (const [fgName, bgName, min] of PAIRS) {
    const fgRaw = resolve(`var(--${fgName})`, theme);
    const bgRaw = resolve(`var(--${bgName})`, theme);
    const fgC = parseColor(fgRaw);
    const bgC = parseColor(bgRaw);
    if (!fgC || !bgC) {
      skipped++;
      continue;
    }
    // Composite translucent colors over the theme's base surface.
    const base = parseColor(resolve('var(--surface-base)', theme));
    const bg = bgC.a < 1 ? compositeOver(bgC, base) : bgC;
    const fg = fgC.a < 1 ? compositeOver(fgC, bg) : fgC;
    const r = ratio(fg, bg);
    if (r < min) {
      failures++;
      console.error(
        `FAIL [${themeName}] --${fgName} on --${bgName}: ${r.toFixed(2)} < ${min}`,
      );
    }
  }
}

if (failures > 0) {
  console.error(`\ncontrast: ${failures} failing pair(s)`);
  process.exit(1);
}
console.log(`contrast: OK (${PAIRS.length * 2 - skipped} pairs checked, ${skipped} color-mix pairs skipped)`);
```

- [ ] **Step 3: Add package scripts**

In `frontend/package.json`, add to `"scripts"` (do NOT touch `"check"` yet — these gates go into `check` in Task 9 once green):

```json
    "lint:css": "node scripts/check-css-colors.mjs",
    "check:contrast": "node scripts/check-contrast.mjs",
```

- [ ] **Step 4: Run both — verify they fail for the right reasons (red baseline)**

Run: `bun run lint:css`
Expected: FAIL listing at least: `shell.css:10` (`rgba(118, 131, 150, 0.34)`), `shell.css` primary-button glow rgba, `shell.css:213` backdrop rgba, `sidebar.css:190` popover shadow rgba, `editor.css:97` dark popover shadow rgba, `editor.css:181`/`editor.css:192` `#d64545`, `editor.css:384` `rgba(45, 212, 111, 0.35)`, plus `#fff` button text colors in shell.css.

Run: `bun run check:contrast`
Expected: FAIL with `Unparseable color: ""` or similar — the semantic tokens (`--surface-base` etc.) don't exist yet. That's the red state Task 2 turns green.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/check-css-colors.mjs frontend/scripts/check-contrast.mjs frontend/package.json
git commit -m "feat(frontend): add css color-literal and contrast verification scripts"
```

---

### Task 2: Semantic token foundation in base.css

**Files:**
- Modify: `frontend/src/styles/base.css` (full rewrite, content below)

**Interfaces:**
- Produces: semantic custom properties consumed by every later task — surfaces (`--surface-base/-panel/-raised/-sunken/-overlay`), text (`--text-primary/-secondary/-tertiary`), borders (`--border-subtle/-default/-strong`), accent (`--accent`, `--accent-hover`, `--accent-tint`, `--accent-alt`, `--on-accent`), status (`--success/-tint`, `--warning/-tint`, `--danger/-tint`), `--backdrop`, shadows (`--shadow-sm/-md/-lg`), radius (`--radius-sm/-md/-lg/-full`), type scale (`--font-size-xs…-3xl`, `--leading-tight/-normal/-relaxed`, `--tracking-tight/-wide`), spacing (`--space-1…-8`), controls (`--control-sm/-md/-lg`), motion (`--duration-fast/-base/-slow`, `--ease-out`).
- Also produces TEMPORARY aliases mapping every old token name to its semantic successor, so all existing CSS keeps working until Task 4 removes them.

- [ ] **Step 1: Replace `frontend/src/styles/base.css` with:**

```css
:root {
  font-family:
    "Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "cv01", "ss03";

  /* ---- type scale ---- */
  --font-size-xs: 11px;
  --font-size-sm: 12px;
  --font-size-md: 13px; /* default UI size */
  --font-size-lg: 15px; /* editor body */
  --font-size-xl: 17px;
  --font-size-2xl: 20px;
  --font-size-3xl: 24px; /* page + note titles */
  --leading-tight: 1.25;
  --leading-normal: 1.45;
  --leading-relaxed: 1.6;
  --tracking-tight: -0.01em;
  --tracking-wide: 0.08em;

  /* ---- spacing (4px grid) ---- */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* ---- shape ---- */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 999px;

  /* ---- control heights ---- */
  --control-sm: 28px;
  --control-md: 32px;
  --control-lg: 36px;

  /* ---- motion ---- */
  --duration-fast: 150ms;
  --duration-base: 200ms;
  --duration-slow: 300ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1);

  /* ---- light theme ---- */
  --surface-base: #eef1f6;
  --surface-panel: #f7f9fc;
  --surface-raised: #ffffff;
  --surface-sunken: #eff3f9;
  --surface-overlay: #ffffff;

  --text-primary: #1a2334;
  --text-secondary: #55617a;
  --text-tertiary: #8390a6;

  --border-subtle: rgba(26, 35, 52, 0.08);
  --border-default: rgba(26, 35, 52, 0.14);
  --border-strong: rgba(26, 35, 52, 0.24);

  --accent: #2563eb;
  --accent-hover: color-mix(in oklab, var(--accent) 88%, #000);
  --accent-tint: color-mix(in oklab, var(--accent) 9%, var(--surface-raised));
  --accent-alt: #6d28d9;
  --on-accent: #ffffff;

  --success: #15803d;
  --success-hover: color-mix(in oklab, var(--success) 88%, #000);
  --success-tint: color-mix(in oklab, var(--success) 10%, var(--surface-raised));
  --warning: #b45309;
  --warning-tint: color-mix(in oklab, var(--warning) 10%, var(--surface-raised));
  --danger: #b91c1c;
  --danger-hover: color-mix(in oklab, var(--danger) 88%, #000);
  --danger-tint: color-mix(in oklab, var(--danger) 8%, var(--surface-raised));

  --backdrop: rgba(9, 13, 20, 0.4);

  --shadow-sm:
    0 1px 2px rgba(26, 35, 52, 0.06),
    0 0 0 1px rgba(26, 35, 52, 0.04);
  --shadow-md:
    0 4px 12px -2px rgba(26, 35, 52, 0.12),
    0 0 0 1px rgba(26, 35, 52, 0.05);
  --shadow-lg:
    0 24px 48px -12px rgba(26, 35, 52, 0.24),
    0 0 0 1px rgba(26, 35, 52, 0.06);

  color: var(--text-primary);
  background: var(--surface-base);
}

:root[data-theme="dark"] {
  --surface-base: #0d1219;
  --surface-panel: #10161f;
  --surface-raised: #161d28;
  --surface-sunken: #0f141c;
  --surface-overlay: #1c2532;

  --text-primary: #e4eaf3;
  --text-secondary: #9aa6ba;
  --text-tertiary: #6e7b90;

  --border-subtle: rgba(255, 255, 255, 0.07);
  --border-default: rgba(255, 255, 255, 0.11);
  --border-strong: rgba(255, 255, 255, 0.18);

  --accent: #5b93ff;
  --accent-hover: color-mix(in oklab, var(--accent) 88%, #fff);
  --accent-tint: color-mix(in oklab, var(--accent) 15%, var(--surface-panel));
  --accent-alt: #a88fff;
  --on-accent: #0d1219;

  --success: #3fcb7c;
  --success-hover: color-mix(in oklab, var(--success) 88%, #fff);
  --success-tint: color-mix(in oklab, var(--success) 14%, var(--surface-panel));
  --warning: #f3a531;
  --warning-tint: color-mix(in oklab, var(--warning) 14%, var(--surface-panel));
  --danger: #ff7a7a;
  --danger-hover: color-mix(in oklab, var(--danger) 88%, #fff);
  --danger-tint: color-mix(in oklab, var(--danger) 12%, var(--surface-panel));

  --backdrop: rgba(2, 4, 8, 0.6);

  --shadow-sm: 0 0 0 1px rgba(255, 255, 255, 0.04);
  --shadow-md:
    0 4px 12px -2px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.06);
  --shadow-lg:
    0 24px 48px -12px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.08);

  color: var(--text-primary);
  background: var(--surface-base);
}

/* TEMPORARY migration aliases — removed in the color-sweep task.
 * Values resolve per-theme through the semantic tokens above,
 * so this single block serves both themes. */
:root {
  --app-bg: var(--surface-base);
  --shell-bg: var(--surface-panel);
  --panel-bg: var(--surface-raised);
  --panel-soft: var(--surface-sunken);
  --text: var(--text-primary);
  --muted: var(--text-secondary);
  --faint: var(--text-tertiary);
  --border: var(--border-default);
  --blue: var(--accent);
  --blue-soft: var(--accent-tint);
  --green: var(--success);
  --green-soft: var(--success-tint);
  --purple: var(--accent-alt);
  --amber: var(--warning);
  --shadow: var(--shadow-lg);
  --radius: var(--radius-md);
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  min-height: 100%;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  color: var(--text-primary);
  background: var(--surface-base);
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  color: inherit;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

button:focus-visible,
summary:focus-visible,
.model-combobox-trigger:focus-visible,
.model-option:focus-visible,
.note-picker-item:focus-visible,
.toolbar-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

input:focus,
textarea:focus,
select:focus {
  outline: none;
}
```

Notes on deliberate changes vs. the old file:
- The old `--border-strong` and `--danger` names survive but with new values (border-strong is now translucent; danger is darker in light mode so white-on-danger buttons pass AA).
- The decorative `linear-gradient` on `body` is removed — the surface ladder now does that work.
- Dark-mode-specific `:root[data-theme="dark"] body` override removed (redundant).
- Text inputs lose the generic `focus-visible` outline; Task 7 gives them a border+ring focus treatment (an input must always show *some* focus state — until Task 7 they briefly rely on the caret only, which is acceptable mid-migration but Task 7 is mandatory).
- `--accent` shifts from `#1f6bff` to `#2563eb` (light) — a slight darkening of the brand blue so accent-as-text and white-on-accent both pass 4.5:1.

- [ ] **Step 2: Verify contrast gate goes green**

Run: `bun run check:contrast`
Expected: `contrast: OK …`. If any pair FAILs, adjust the failing token's lightness in `base.css` minimally (darken light-mode fg / lighten dark-mode fg) and re-run until green. Do not weaken the PAIRS list.

- [ ] **Step 3: Verify nothing broke**

Run: `bun run check && bun run test`
Expected: PASS (aliases keep every existing rule resolving).

- [ ] **Step 4: Visual smoke check**

Run: `bun run --cwd .. frontend:build` is not needed; instead start Vite: `bun run dev` (from `frontend/`), open `http://localhost:5173`, toggle Light/Dark/System in Settings. Expected: app renders in both themes with slightly refreshed colors, no unstyled regions, no console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/base.css
git commit -m "feat(frontend): semantic design token foundation with per-theme values"
```

---

### Task 3: Bundle Inter Variable locally

**Files:**
- Modify: `frontend/package.json` (via `bun add`)
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `font-family` stack in `base.css` already lists `"Inter Variable"` first (Task 2).
- Produces: the `Inter Variable` font-face available offline in the Tauri bundle.

- [ ] **Step 1: Install**

Run: `bun add @fontsource-variable/inter` (in `frontend/`)
Expected: dependency added to `frontend/package.json`.

- [ ] **Step 2: Import the font before the style modules**

Replace `frontend/src/styles.css` content with:

```css
@import '@fontsource-variable/inter';

@import './styles/base.css';
@import './styles/shell.css';
@import './styles/sidebar.css';
@import './styles/editor.css';
@import './styles/collections.css';
@import './styles/responsive.css';
```

- [ ] **Step 3: Verify**

Run: `bun run dev`, open the app, inspect any label in devtools → Computed → `font-family` resolves to `Inter Variable`. Also `bun run check && bun run test` → PASS. Confirm the built bundle self-hosts the font (no network requests to fonts.googleapis.com in the Network tab).

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/bun.lock frontend/src/styles.css
git commit -m "feat(frontend): bundle Inter Variable with cv01/ss03 features"
```

(If the lockfile is `bun.lockb`, add that instead.)

---

### Task 4: Color sweep — all CSS consumes semantic tokens; aliases removed

**Files:**
- Modify: `frontend/src/styles/base.css` (delete alias block)
- Modify: `frontend/src/styles/shell.css`
- Modify: `frontend/src/styles/sidebar.css`
- Modify: `frontend/src/styles/editor.css`
- Modify: `frontend/src/styles/collections.css`
- Modify: `frontend/src/styles/responsive.css` (only if it references old names — currently it doesn't reference colors)

**Interfaces:**
- Consumes: all semantic tokens from Task 2.
- Produces: zero raw color literals and zero old token names outside `base.css`; `bun run lint:css` green.

- [ ] **Step 1: Mechanical rename in the five style-module files (NOT base.css)**

Apply exactly this mapping everywhere in `shell.css`, `sidebar.css`, `editor.css`, `collections.css`, `responsive.css`:

| Old | New |
|---|---|
| `var(--app-bg)` | `var(--surface-base)` |
| `var(--shell-bg)` | `var(--surface-panel)` |
| `var(--panel-bg)` | `var(--surface-raised)` |
| `var(--panel-soft)` | `var(--surface-sunken)` |
| `var(--text)` | `var(--text-primary)` |
| `var(--muted)` | `var(--text-secondary)` |
| `var(--faint)` | `var(--text-tertiary)` |
| `var(--border)` | `var(--border-default)` |
| `var(--blue)` | `var(--accent)` |
| `var(--blue-soft)` | `var(--accent-tint)` |
| `var(--green)` | `var(--success)` |
| `var(--green-soft)` | `var(--success-tint)` |
| `var(--purple)` | `var(--accent-alt)` |
| `var(--amber)` | `var(--warning)` |
| `var(--shadow)` | `var(--shadow-lg)` |
| `var(--radius)` | `var(--radius-md)` |

(`var(--border-strong)` and `var(--danger)` keep their names.)

- [ ] **Step 2: Replace every raw color literal in the style modules**

Exact replacements (line numbers are pre-Task-4 references):

`shell.css`:
- `:10` `.app-shell` → `border: 1px solid var(--border-default);` and keep `box-shadow: var(--shadow-lg);`
- `:15-18` delete the `:root[data-theme="dark"] .app-shell` block (tokens handle it).
- `:20-22` delete `:root[data-theme="dark"] .primary-button { box-shadow: … }` (glow shadows retired).
- `:116` `.primary-button` → `color: var(--on-accent); background: var(--accent);` and **delete** its `box-shadow` line.
- `:121-131` `.success-button` → `color: var(--on-accent); background: var(--success);` and `.danger-button` → `color: var(--on-accent); background: var(--danger);`, deleting both `box-shadow` glow lines. This is correct in both themes without overrides: light-mode fills are deep (white text passes AA — the contrast gate checks `on-accent` against all three fills), and dark-mode fills are light pastels with `--on-accent` flipped to near-black.
- `:213` `.confirmation-dialog::backdrop` → `background: var(--backdrop);`

`sidebar.css`:
- `:190` `.model-combobox-popover` → `box-shadow: var(--shadow-md);` and `border: 1px solid var(--border-default);` and `background: var(--surface-overlay);`

`editor.css`:
- `:67-98` delete ALL five `:root[data-theme="dark"] …` override blocks (lines 67–98: editor-card border group, input border group, format-toolbar, editor-footer, popover shadow). With per-theme token values they are redundant. The `format-toolbar`/`editor-footer` borders stay `var(--border-default)` in both themes (was `--border-strong` in dark — the new translucent default is visible enough; verify visually in Step 5).
- `:144` `.toolbar-button[aria-pressed="true"]` → `color: var(--accent);` — **bug fix**: `var(--accent)` was referenced but never defined before this plan; the pressed state silently fell back to inherited color. Now it works by design.
- `:181` → `border-color: var(--danger);` (drop the `, #d64545` fallback)
- `:192` → `color: var(--danger);` (drop the fallback)
- `:384` `.ai-provider-state.ready` → `border-color: color-mix(in oklab, var(--success) 40%, transparent);`

`collections.css`: no raw literals — mechanical rename only (Step 1 covers it). While here, change `.testware-metadata-badges span` and `.note-picker-item.active`/`.model-option.active`/`.rail-item.active` `color-mix(in srgb, …)` calls to `color-mix(in oklab, …)` for perceptual consistency (same arguments otherwise). Apply the same `srgb`→`oklab` swap in the other files' `color-mix()` calls.

- [ ] **Step 3: Delete the alias block from base.css**

Remove the entire `/* TEMPORARY migration aliases … */ :root { … }` block added in Task 2.

- [ ] **Step 4: Verify with greps + gates**

```bash
grep -rnE 'var\(--(app-bg|shell-bg|panel-bg|panel-soft|text|muted|faint|border|blue|blue-soft|green|green-soft|purple|amber|shadow|radius)\)' frontend/src/styles/
```
Expected: no output (note: the regex is word-exact via `\)`; `--text-primary` etc. do not match).

Run: `bun run lint:css` → Expected: `css colors: OK …`
Run: `bun run check:contrast` → PASS
Run: `bun run check && bun run test` → PASS
Also grep TSX for stragglers: `grep -rnE '#[0-9a-fA-F]{3,6}\b|rgba?\(' frontend/src --include='*.tsx' --include='*.ts' | grep -v test` → review any hits; expected: none in production code.

- [ ] **Step 5: Visual check both themes**

`bun run dev` → check: buttons (primary/success/danger readable in both themes), dialog backdrop, model popover shadow, toolbar pressed state now shows accent color, editor card borders visible in dark mode.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles/
git commit -m "refactor(frontend): sweep all styles onto semantic color tokens"
```

---

### Task 5: Typography sweep

**Files:**
- Modify: `frontend/src/styles/shell.css`, `sidebar.css`, `editor.css`, `collections.css`, `responsive.css`

**Interfaces:**
- Consumes: `--font-size-*`, `--leading-*`, `--tracking-*` from Task 2.
- Produces: every `font-size`, `font-weight`, `line-height`, `letter-spacing` in the style modules uses scale tokens / allowed weights.

- [ ] **Step 1: Apply the font-size mapping everywhere**

| Old literal | New |
|---|---|
| `11px` | `var(--font-size-xs)` |
| `12px` | `var(--font-size-sm)` |
| `13px`, `14px` | `var(--font-size-md)` |
| `15px` | `var(--font-size-lg)` |
| `17px` | `var(--font-size-xl)` |
| `19px`, `20px` | `var(--font-size-2xl)` |
| `25px`, `28px`, `30px` | `var(--font-size-3xl)` |

Notable effects (intended): note title 30→24, collection h1 28→24, record-title 19→20, default UI text 14→13. In `responsive.css:166` the mobile note-title override (`25px`) becomes `var(--font-size-2xl)` (20px) instead of 3xl, keeping a mobile step-down.

- [ ] **Step 2: Apply the font-weight mapping everywhere**

| Old | New |
|---|---|
| `650`, `700`, `750` | `600` |
| `500` | `500` |

- [ ] **Step 3: Apply line-height and letter-spacing mappings**

| Old | New |
|---|---|
| `1.2`, `1.25`, `1.3`, `1.35` | `var(--leading-tight)` |
| `1.45`, `1.5`, `1.55` | `var(--leading-normal)` |
| `1.6`, `1.68` | `var(--leading-relaxed)` |
| `letter-spacing: 0.08em` | `letter-spacing: var(--tracking-wide)` |
| `letter-spacing: 0` (brand, note title) | `letter-spacing: var(--tracking-tight)` |

Then add tightening + tabular numerals — new rules at the end of `shell.css`:

```css
.top-bar,
.left-rail,
.editor-footer,
.document-status {
  letter-spacing: var(--tracking-tight);
}

.rail-item strong,
.document-status,
.testware-metadata-badges span,
.ai-provider-state {
  font-variant-numeric: tabular-nums;
}
```

In `editor.css`, `.note-title-input` gets `letter-spacing: var(--tracking-tight);` (replacing `letter-spacing: 0`), and `.rich-editor h2, .rich-editor h3` get `letter-spacing: var(--tracking-tight);` via a new declaration in each existing rule.

- [ ] **Step 4: Verify**

```bash
grep -rnE 'font-size:\s*[0-9]' frontend/src/styles/ --include='*.css' | grep -v base.css
grep -rnE 'font-weight:\s*(650|700|750)' frontend/src/styles/
```
Expected: both empty.
Run: `bun run check && bun run test && bun run lint:css` → PASS.
Visual check: hierarchy still reads (titles > headings > body > labels), nothing bold-heavy, numbers in rail badges align.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/
git commit -m "refactor(frontend): tokenized type scale — Inter Variable, weights 400-600"
```

---

### Task 6: Spacing, control metrics, and chrome slimming

**Files:**
- Modify: `frontend/src/styles/shell.css`, `sidebar.css`, `editor.css`, `collections.css`, `responsive.css`

**Interfaces:**
- Consumes: `--space-*`, `--control-*` from Task 2.
- Produces: all gaps/paddings/margins on the 4px scale; standardized control heights; 60px top bar.

- [ ] **Step 1: Apply the spacing mapping to `gap`, `padding`, `margin` values only**

| Old px | New |
|---|---|
| `3`, `4`, `5` | `var(--space-1)` |
| `6`, `7`, `8`, `9`, `10` | `var(--space-2)` |
| `11`, `12`, `14` | `var(--space-3)` |
| `16`, `18` | `var(--space-4)` |
| `20`, `22` | `var(--space-5)` |
| `24`, `26`, `28` | `var(--space-6)` |
| `32`, `34` | `var(--space-8)` |

Exemptions (leave untouched): `1px`/`2px` micro values, all `width`/`height`/`min-height`/`max-height` of content boxes (e.g. `.note-picker-list max-height: 278px`, textarea min-heights), negative margins (`-1px`, `-2px`, `-4px`, `-8px` — round `-8px` to `calc(-1 * var(--space-2))` only if trivial, otherwise leave), and grid `minmax()` column widths. Shorthand values map per-component: e.g. `padding: 0 28px 0 26px` → `padding: 0 var(--space-6)`; `padding: 34px 28px` → `padding: var(--space-8) var(--space-6)`; `padding: 24px 24px 22px` → `padding: var(--space-6) var(--space-6) var(--space-5)`.

- [ ] **Step 2: Standardize control heights**

| Selector (file) | Old | New |
|---|---|---|
| `.global-search` height (shell) | 46px | `var(--control-lg)` |
| `.primary-button`,`.secondary-button` min-height (shell) | 38px | `var(--control-lg)` |
| `.icon-button` width/height (shell) | 38px | `var(--control-lg)` |
| `.compact-button` min-height (shell) | 34px | `var(--control-md)` |
| `.preflight-select-field select` min-height (shell) | 40px | `var(--control-lg)` |
| `.preflight-toggle-grid label` min-height (shell) | 38px | `var(--control-lg)` |
| `.select-shell` height (sidebar) | 40px | `var(--control-lg)` |
| `.rail-item`,`.settings-link` min-height (sidebar) | 42px | `var(--control-lg)` |
| `.model-search` height (sidebar) | 36px | `var(--control-lg)` |
| `.format-toolbar` min-height (editor) | 54px | 48px |
| `.toolbar-button`, `.format-toolbar select`, `.link-editor-input`, `.link-editor-apply` height (editor) | 34px | `var(--control-md)` |
| `.ai-action-buttons .primary-button/.secondary-button` min-height (editor) | 38px | `var(--control-lg)` |
| `.editable-record input` height (collections) | 40px | `var(--control-lg)` |
| `.settings-view .select-shell` height (collections) | 40px | `var(--control-lg)` |
| `.theme-toggle button` height (collections) | 32px | `var(--control-sm)` |
| `.settings-section-heading .compact-button` min-height (collections) | 30px | `var(--control-sm)` |

Leave content-driven heights (`.model-combobox-trigger` 50px → change to 48px literal, `.note-picker-item` 48px stays, `.editor-footer` 56px → 52px, `.ai-provider-summary` 40px stays).

- [ ] **Step 3: Slim the app chrome**

`shell.css` `.app-shell`: `grid-template-rows: 86px 1fr;` → `grid-template-rows: 60px 1fr;`
`responsive.css` (≤1100px) `.app-shell`: `grid-template-rows: 76px 1fr;` → `grid-template-rows: 56px 1fr;`
`shell.css` `.top-bar`: `padding: 0 28px 0 26px` → `padding: 0 var(--space-5)` (denser chrome), and `.brand-mark` 34px → 28px width/height so it fits the 60px bar comfortably.

- [ ] **Step 4: Verify**

```bash
grep -rnE '(gap|padding|margin)[^:]*:\s*[^;]*\b(3|5|6|7|9|10|11|14|18|22|26|28|34)px' frontend/src/styles/ | grep -v base.css
```
Expected: empty (allow judged exceptions only if visually necessary — document any in the commit message).
Run: `bun run check && bun run test && bun run lint:css` → PASS.
Visual check both themes at desktop width AND ≤760px: top bar fits (search, buttons, toggle), rail items aligned, dialogs padded sanely, editor toolbar not cramped, nothing clipped.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/
git commit -m "refactor(frontend): 4px spacing grid, standard control heights, slimmer chrome"
```

---

### Task 7: Interaction states and motion

**Files:**
- Modify: `frontend/src/styles/base.css` (transitions, input focus)
- Modify: `frontend/src/styles/shell.css` (button states)
- Modify: `frontend/src/styles/sidebar.css` (rail/list states)
- Modify: `frontend/src/styles/collections.css` (theme toggle, inputs)
- Modify: `frontend/src/styles/responsive.css` (reduced motion)

**Interfaces:**
- Consumes: `--duration-*`, `--ease-out`, `--accent`, `--accent-tint`, `--border-strong`, `--surface-sunken`, `--shadow-sm`.
- Produces: complete default/hover/focus/active/disabled coverage; global reduced-motion escape hatch.

- [ ] **Step 1: Global transitions + input focus (base.css, append after the focus-visible rule)**

```css
button,
select {
  transition:
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

input,
textarea {
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

/* Text fields show focus persistently (not only keyboard-driven). */
input:focus,
textarea:focus,
select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-tint);
}
```

Note: inputs with `border: 0` inside shells (`.global-search input`, `.model-search input`, `.select-shell select`) get no visible ring from this — the shells handle it in Step 3.

- [ ] **Step 2: Button state matrix (shell.css, after the `.icon-button.danger:hover` rule)**

```css
.primary-button:hover {
  background: var(--accent-hover);
}

.success-button:hover {
  background: var(--success-hover);
}

.danger-button:hover {
  background: var(--danger-hover);
}

.secondary-button:hover {
  background: var(--surface-sunken);
  border-color: var(--border-strong);
}

.primary-button:active,
.secondary-button:active,
.success-button:active,
.danger-button:active,
.icon-button:active,
.toolbar-button:active {
  transform: scale(0.98);
}

button:disabled:hover {
  transform: none;
}
```

(The existing `.toolbar-button:disabled:hover { background: transparent; }` in editor.css stays.)

- [ ] **Step 3: Focus-within on composite fields (shell.css `.global-search` area + sidebar.css `.model-search`, `.select-shell`)**

Add in shell.css:

```css
.global-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-tint);
}
```

Add in sidebar.css:

```css
.select-shell:focus-within,
.model-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-tint);
}
```

- [ ] **Step 4: Rail + list item states (sidebar.css)**

Extend existing rules (hover already sets `background: var(--surface-sunken)` via editor.css's shared rule — keep) and add:

```css
.rail-item:hover,
.settings-link:hover {
  color: var(--text-primary);
}

.rail-item.active,
.settings-link.active {
  font-weight: 600;
}
```

- [ ] **Step 5: Theme toggle active state (collections.css `.theme-toggle button.active`)**

Replace the rule body with:

```css
.theme-toggle button.active {
  color: var(--text-primary);
  font-weight: 600;
  background: var(--surface-raised);
  box-shadow: var(--shadow-sm);
}
```

- [ ] **Step 6: Reduced motion (responsive.css, top of file)**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 7: Verify**

Run: `bun run check && bun run test && bun run lint:css && bun run check:contrast` → PASS.
Manual pass in `bun run dev`, both themes: every button hovers visibly + presses with a tiny scale; Tab-order shows a ring on every interactive element; text fields glow on focus; disabled buttons don't react to hover. macOS System Settings → Accessibility → Reduce Motion: spinner and transitions stop animating.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/styles/
git commit -m "feat(frontend): complete interaction-state matrix and motion tokens"
```

---

### Task 8: Surface polish — dialogs, popovers, cards, empty states

**Files:**
- Modify: `frontend/src/styles/shell.css` (dialog)
- Modify: `frontend/src/styles/sidebar.css` (popover)
- Modify: `frontend/src/styles/editor.css` (editor card, empty states)
- Modify: `frontend/src/components/Common.tsx` (only if the empty-state selector needs a hook — check first)

**Interfaces:**
- Consumes: `--surface-overlay`, `--shadow-md/-lg`, `--radius-lg`, `--duration-*`, `--ease-out`, `--accent`, `--accent-tint`, `--backdrop`.

- [ ] **Step 1: Dialog treatment (shell.css `.confirmation-dialog`)**

Update the existing rule: `background: var(--surface-overlay); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);` (keep layout properties). Then add:

```css
.confirmation-dialog[open] {
  animation: dialog-in var(--duration-base) var(--ease-out);
}

.confirmation-dialog::backdrop {
  background: var(--backdrop);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

@keyframes dialog-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.98);
  }
}
```

(`::backdrop` already exists — merge, keeping `var(--backdrop)` from Task 4.)

- [ ] **Step 2: Popover motion (sidebar.css `.model-combobox-popover`)**

Ensure `background: var(--surface-overlay); box-shadow: var(--shadow-md);` (done in Task 4), and add:

```css
.model-combobox-popover {
  animation: popover-in var(--duration-fast) var(--ease-out);
}

@keyframes popover-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
}
```

(Add the `animation` line into the existing rule rather than a duplicate selector.)

- [ ] **Step 3: Editor card gets a quiet lift (editor.css `.editor-card`)**

Add `box-shadow: var(--shadow-sm);` to the existing `.editor-card` rule. Same for `.editable-record, .template-field, .settings-grid section` in collections.css.

- [ ] **Step 4: Empty states (editor.css)**

First check the markup: `grep -n 'svg\|Icon' frontend/src/components/Common.tsx` and the `.workspace-empty` JSX in `frontend/src/views/SessionEditorView.tsx` / `AppShell.tsx` to confirm the icon is a direct child of the container. Then add:

```css
.workspace-empty > svg,
.empty-collection > svg {
  box-sizing: content-box;
  padding: var(--space-4);
  color: var(--accent);
  background: var(--accent-tint);
  border-radius: var(--radius-full);
}
```

If the icon is nested one level deeper, adjust the selector to match the real structure (e.g. `.empty-collection .empty-icon svg`) — do not add a wrapper element unless no stable selector exists; if a wrapper IS needed, add `<div className="empty-icon">` around the icon in `Common.tsx` and keep the change to that one line.

- [ ] **Step 5: Verify**

Run: `bun run check && bun run test && bun run lint:css` → PASS.
Manual, both themes: open the delete-confirmation dialog (animates in, blurred backdrop), open the model combobox (soft shadow, slides in), empty state on a fresh section shows the tinted icon disc.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles/ frontend/src/components/Common.tsx
git commit -m "feat(frontend): dialog/popover motion, card elevation, empty-state polish"
```

---

### Task 9: Final gate — wire checks into CI, dead-code sweep, full verification

**Files:**
- Modify: `frontend/package.json` (`check` script)
- Possibly modify: `frontend/src/styles/*.css` (dead selectors, if grep finds any)

**Interfaces:**
- Consumes: everything above.
- Produces: `bun run check` permanently enforces the color-literal and contrast gates.

- [ ] **Step 1: Wire the gates into `check`**

In `frontend/package.json`:

```json
    "check": "bun run typecheck && bun run lint && bun run lint:css && bun run check:contrast",
```

Run: `bun run check` → PASS.

- [ ] **Step 2: Dead-selector sweep**

For each class defined in the CSS modules, confirm a consumer exists. Quick pass for the suspects flagged in `docs/improvement-plan.md`:

```bash
for c in record-card record-grid model-selector provider-hint; do
  echo "== $c =="; grep -rn "$c" frontend/src --include='*.tsx' --include='*.ts' --include='*.css';
done
```
Expected: these no longer exist anywhere (they were already removed). If any CSS-only definition shows up (CSS hit without a TSX hit), delete that CSS rule.

- [ ] **Step 3: Full verification**

From repo root: `bun run verify:fast` (frontend typecheck + lint + test, then cargo fmt/clippy — confirmed present in root `package.json`).
Expected: PASS.

- [ ] **Step 4: Screenshot review — the visual acceptance pass**

Run the real app: `bun run dev` (repo root; launches Tauri). For **each** of: Sessions editor (with content + empty), Testware, Findings, Templates, Settings, delete dialog, generation preflight, model combobox open — review in **both** themes:

- Squint test: hierarchy still reads (what's above what, where regions divide).
- Nothing pure white on pure black; no invisible borders; no harsh borders.
- Accent appears only on: active nav, primary buttons, focus rings, pressed toolbar buttons, counts, eyebrows.
- Both themes feel equally finished (dark is not "light but inverted").

Fix anything that fails by adjusting **token values in base.css only** (component CSS is frozen at this point unless a real bug appears). Re-run `bun run check:contrast` after any token change.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/src/styles/
git commit -m "chore(frontend): enforce css token + contrast gates in check; drop dead selectors"
```

---

## Execution notes

- Tasks are strictly ordered; each leaves the app shippable.
- If a visual judgment call comes up mid-task (a mapped value looks clearly worse), prefer the token nearest the old value and note it in the commit message — do not invent off-scale values.
- The contrast script is the arbiter for color tweaks; the screenshot pass in Task 9 is the arbiter for everything else.
