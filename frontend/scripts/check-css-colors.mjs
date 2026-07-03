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
