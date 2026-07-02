import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const MACOS_DMG_BASENAME = 'QA.Scribe'

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
