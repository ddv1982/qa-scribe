import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { parse } = require('@babel/parser')
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'])
const excluded = new Set(['node_modules', '.git', 'target', 'dist', 'artifacts', 'vendor'])

export function scanCompilerImports({ maintained, installed }) {
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
    const nodeCreateRequire = syntax.program.body.some(node => node.type === 'ImportDeclaration' && node.importKind !== 'type' && ['node:module', 'module'].includes(node.source.value) && node.specifiers.some(specifier => specifier.imported?.name === 'createRequire' && specifier.local.name === 'createRequire'))
    const literal = node => node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : node?.value
    function visit(node) {
      if (!node || typeof node !== 'object') return
      let specifier
      if (node.type === 'ImportDeclaration' && node.importKind !== 'type' && (node.specifiers.length === 0 || !node.specifiers.every(row => row.importKind === 'type'))) specifier = node.source.value
      if (['ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.exportKind !== 'type' && (!node.specifiers?.length || !node.specifiers.every(row => row.exportKind === 'type'))) specifier = node.source?.value
      if (node.type === 'TSImportEqualsDeclaration' && node.importKind !== 'type' && !node.isTypeOnly && node.moduleReference.type === 'TSExternalModuleReference') specifier = literal(node.moduleReference.expression)
      if (node.type === 'ImportExpression') specifier = literal(node.source)
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require') specifier = literal(node.arguments[0])
      if (nodeCreateRequire && node.type === 'CallExpression' && node.callee?.type === 'CallExpression' && node.callee.callee?.type === 'Identifier' && node.callee.callee.name === 'createRequire') specifier = literal(node.arguments[0])
      if (typeof specifier === 'string' && (specifier === 'typescript' || specifier.startsWith('typescript/lib/'))) imports.push({ file, specifier, line: node.loc.start.line })
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value)
      }
    }
    visit(syntax.program)
  }
  function walk(directory, exclusions) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory() && !exclusions.has(entry.name)) walk(path, exclusions)
      else if (entry.isFile()) inspect(path)
    }
  }
  for (const directory of new Set(maintained)) walk(directory, excluded)
  for (const directory of new Set(installed)) walk(directory, new Set(['node_modules']))
  return { imports, scannedFiles }
}
