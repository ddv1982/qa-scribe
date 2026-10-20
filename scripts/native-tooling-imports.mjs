import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { parse } = require('@babel/parser')
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'])
const excluded = new Set(['node_modules', '.git', 'target', 'dist', 'artifacts', 'vendor'])

export function scanCompilerImports(directories) {
  const imports = []
  let scannedFiles = 0
  function inspect(file) {
    if (!sourceExtensions.has(extname(file)) || /\.d\.(ts|mts|cts)$/.test(file)) return
    scannedFiles++
    const source = readFileSync(file, 'utf8')
    if (!source.includes('typescript')) return
    let syntax
    try { syntax = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'decorators-legacy', ...(/\.[jt]sx$/.test(file) ? ['jsx'] : [])], createImportExpressions: true }) }
    catch (error) { throw new Error(`Cannot inspect runtime imports in ${file}: ${error.message}`) }
    function visit(node) {
      if (!node || typeof node !== 'object') return
      let specifier
      if (node.type === 'ImportDeclaration' && node.importKind !== 'type' && (node.specifiers.length === 0 || !node.specifiers.every(row => row.importKind === 'type'))) specifier = node.source.value
      if (['ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.exportKind !== 'type' && (!node.specifiers?.length || !node.specifiers.every(row => row.exportKind === 'type'))) specifier = node.source?.value
      if (node.type === 'ImportExpression') specifier = node.source?.value
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require') specifier = node.arguments[0]?.value
      if (typeof specifier === 'string' && (specifier === 'typescript' || specifier.startsWith('typescript/lib/'))) imports.push({ file, specifier, line: node.loc.start.line })
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value)
      }
    }
    visit(syntax.program)
  }
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory() && !excluded.has(entry.name)) walk(path)
      else if (entry.isFile()) inspect(path)
    }
  }
  for (const directory of new Set(directories)) walk(directory)
  return { imports, scannedFiles }
}
