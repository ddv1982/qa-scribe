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
