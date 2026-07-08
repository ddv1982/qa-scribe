#!/usr/bin/env node
// Gate: raw color literals may only live in src/styles/base.css.
// Everything else must consume semantic tokens (var(--...)).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const stylesDir = fileURLToPath(new URL('../src/styles', import.meta.url));
const ALLOWED = new Set(['base.css']);
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\boklab\(/;
const CUSTOM_PROPERTY_DEF = /(^|[\s{;])(--[\w-]+)\s*:/g;
const CUSTOM_PROPERTY_REF = /var\((--[\w-]+)/g;

const violations = [];
const undefinedTokens = [];
const stylesheets = readdirSync(stylesDir)
  .filter((file) => file.endsWith('.css'))
  .sort()
  .map((file) => ({ file, content: readFileSync(join(stylesDir, file), 'utf8') }));
const definedTokens = new Set();

for (const { content } of stylesheets) {
  for (const match of content.matchAll(CUSTOM_PROPERTY_DEF)) definedTokens.add(match[2]);
}

for (const { file, content } of stylesheets) {
  if (!file.endsWith('.css') || ALLOWED.has(file)) continue;
  content.split('\n').forEach((line, i) => {
    if (COLOR_LITERAL.test(line)) violations.push(`${file}:${i + 1}: ${line.trim()}`);
  });
}

for (const { file, content } of stylesheets) {
  content.split('\n').forEach((line, i) => {
    for (const match of line.matchAll(CUSTOM_PROPERTY_REF)) {
      if (!definedTokens.has(match[1])) undefinedTokens.push(`${file}:${i + 1}: ${match[1]}`);
    }
  });
}

if (violations.length > 0) {
  console.error(`Raw color literals outside base.css (${violations.length}):`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
if (undefinedTokens.length > 0) {
  console.error(`Undefined CSS custom properties (${undefinedTokens.length}):`);
  for (const token of undefinedTokens) console.error(`  ${token}`);
  process.exit(1);
}
console.log('css colors: OK — all color literals confined to base.css and custom properties resolve');
