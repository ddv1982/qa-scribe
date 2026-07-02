#!/usr/bin/env node
// Wrap the Tauri-built "QA Scribe.app" staged under dist/rust/build as a DMG.
// The .app itself is produced by `cargo tauri build --bundles app`.
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { basename, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { macosDmgName, resolveCommand, run } from './command-utils.mjs'

const projectRoot = process.cwd()
const knownFlags = new Set(['--skip-build', '--dmg-only', '--skip-missing-tools'])
const args = process.argv.slice(2)
const unknownFlags = args.filter((arg) => !knownFlags.has(arg))
if (unknownFlags.length > 0) {
  console.error(`Unknown argument(s): ${unknownFlags.join(', ')}`)
  console.error(`Supported arguments: ${[...knownFlags].join(', ')}`)
  process.exit(1)
}
const skipMissingTools = args.includes('--skip-missing-tools')

const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const packageName = 'qa-scribe'
const appName = 'QA Scribe'
const version = packageJson.version
const macArch = process.env.MACOS_ARCH || (process.arch === 'arm64' ? 'arm64' : 'x64')
const artifactsDir = join(projectRoot, 'dist', 'rust', 'artifacts')
const buildDir = join(projectRoot, 'dist', 'rust', 'build')
const appDir = join(buildDir, `${appName}.app`)
const dmgPath = join(artifactsDir, macosDmgName(version, macArch))

mkdirSync(artifactsDir, { recursive: true })

buildDmg()

console.log('Rust macOS artifacts:')
if (existsSync(dmgPath)) {
  console.log(`- ${relative(projectRoot, dmgPath)}`)
}

function buildDmg() {
  if (!existsSync(appDir)) {
    throw new Error(
      `App bundle not found at ${relative(projectRoot, appDir)}. ` +
        'Build it with `cargo tauri build --bundles app` and stage it there first.'
    )
  }

  const hdiutil = resolveCommand('hdiutil')
  if (!hdiutil) {
    if (skipMissingTools) {
      console.warn('Skipping DMG generation: hdiutil was not found.')
      return
    }
    throw new Error('DMG generation requires hdiutil.')
  }

  const dmgRoot = join(tmpdir(), `${packageName}-dmg-${Date.now()}`)
  rmSync(dmgRoot, { recursive: true, force: true })
  rmSync(dmgPath, { force: true })
  mkdirSync(dmgRoot, { recursive: true })
  copyTree(appDir, join(dmgRoot, basename(appDir)))
  symlinkSync('/Applications', join(dmgRoot, 'Applications'))
  try {
    run(hdiutil, ['create', '-volname', appName, '-srcfolder', dmgRoot, '-ov', '-format', 'UDZO', dmgPath])
  } finally {
    rmSync(dmgRoot, { recursive: true, force: true })
  }
}

function copyTree(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name)
    const targetPath = join(target, entry.name)
    if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(sourcePath), targetPath)
    } else if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath)
    } else if (entry.isFile()) {
      copyFileSync(sourcePath, targetPath)
      chmodSync(targetPath, lstatSync(sourcePath).mode & 0o777)
    } else {
      throw new Error(`Refusing to stage unsupported file type into the DMG: ${sourcePath}`)
    }
  }
}
