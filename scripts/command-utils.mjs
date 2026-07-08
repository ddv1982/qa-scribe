import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const RELEASE_CONSTANTS = JSON.parse(readFileSync(join(SCRIPTS_DIR, 'release-constants.json'), 'utf8'))

const MACOS_DMG_BASENAME = RELEASE_CONSTANTS.dmgBaseName

export const QA_SCRIBE_CARGO_LOCK_PACKAGES = ['qa-scribe-app', 'qa-scribe-core', 'qa-scribe-tauri']

export function readReleaseConstants() {
  return RELEASE_CONSTANTS
}

export function readOption(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined

  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

export function resolveCommand(command) {
  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : ['']

  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }

  return undefined
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
    shell: false
  })

  if (result.status === 0) return result
  const error = new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
  error.exitCode = result.status ?? 1
  throw error
}

export function macosArtifactArch(macArch) {
  return macArch === 'arm64' ? 'aarch64' : macArch
}

export function macosDmgName(version, macArch) {
  return `${MACOS_DMG_BASENAME}_${version}_${macosArtifactArch(macArch)}.dmg`
}

export function isDesktopArtifactName(name) {
  return /\.(?:deb|rpm|AppImage|dmg)$/i.test(name) || name.endsWith('.tar.gz')
}

export function isAuxiliaryArtifactName(name) {
  return name.startsWith('qa-scribe-repository-setup_')
}

export function isCurrentVersionDesktopArtifactName(name, version) {
  if (name.endsWith('.deb')) {
    return new RegExp(`^qa-scribe_${escapeRegExp(version)}_[A-Za-z0-9_]+\\.deb$`).test(name)
  }
  if (name.endsWith('.rpm')) {
    return new RegExp(`^qa-scribe-${escapeRegExp(version)}-[A-Za-z0-9_.+-]+\\.rpm$`).test(name)
  }
  if (name.endsWith('.AppImage')) {
    return new RegExp(`(^|[_ .-])${escapeRegExp(version)}([_ .-]|$)`).test(name)
  }
  if (name.endsWith('.dmg')) {
    return new RegExp(`^${escapeRegExp(MACOS_DMG_BASENAME)}_${escapeRegExp(version)}_[A-Za-z0-9_]+\\.dmg$`).test(name)
  }
  if (name.endsWith('.tar.gz')) {
    return new RegExp(`^qa-scribe-${escapeRegExp(version)}-(?:linux|macos)-[A-Za-z0-9_+-]+(?:\\.app)?\\.tar\\.gz$`).test(name)
  }
  return false
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function validateSemver(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
}

export function readWorkspaceCargoVersion(cargoToml) {
  const workspacePackageMatch = cargoToml.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/)
  if (!workspacePackageMatch) {
    return null
  }

  const versionMatch = workspacePackageMatch[1].match(/^\s*version\s*=\s*"([^"]+)"\s*$/m)
  return versionMatch?.[1] ?? null
}

export function cargoLockPackageVersions(cargoLock, packageNames = QA_SCRIBE_CARGO_LOCK_PACKAGES) {
  const wanted = new Set(packageNames)
  const versions = Object.fromEntries(packageNames.map(packageName => [packageName, null]))
  for (const block of cargoLock.split(/\n(?=\[\[package\]\]\n)/)) {
    const name = block.match(/^name = "([^"]+)"$/m)?.[1]
    if (!wanted.has(name)) {
      continue
    }
    versions[name] = block.match(/^version = "([^"]+)"$/m)?.[1] ?? null
  }
  return versions
}

export function findChangelogRelease(changelog, tag) {
  const headingPattern = new RegExp(`^## ${escapeRegExp(tag)} - \\d{4}-\\d{2}-\\d{2}$`)
  const lines = changelog.split(/\r?\n/)
  const headingIndex = lines.findIndex(line => headingPattern.test(line))

  if (headingIndex === -1) {
    return null
  }

  const date = lines[headingIndex].replace(new RegExp(`^## ${escapeRegExp(tag)} - `), '')
  const sectionLines = []
  for (const line of lines.slice(headingIndex + 1)) {
    if (line.startsWith('## ')) {
      break
    }
    sectionLines.push(line)
  }

  return {
    date,
    notes: sectionLines.join('\n').trim()
  }
}

export function latestMetainfoRelease(metainfo) {
  const match = metainfo.match(/<release\s+([^>]*)/)
  if (!match) {
    return null
  }

  const attrs = new Map()
  for (const attr of match[1].matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)) {
    attrs.set(attr[1], attr[2])
  }

  const version = attrs.get('version')
  const date = attrs.get('date')
  if (!version || !date) {
    return null
  }

  return {
    version,
    date
  }
}
