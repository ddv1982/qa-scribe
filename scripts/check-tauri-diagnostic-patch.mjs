import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function checkTauriDiagnosticPatch(frontend = fileURLToPath(new URL('../frontend/', import.meta.url))) {
  const manifest = JSON.parse(readFileSync(join(frontend, 'package.json'), 'utf8'))
  const patch = 'patches/@wdio%2Ftauri-service@1.2.0.patch'
  if (manifest.devDependencies?.['@wdio/tauri-service'] !== '1.2.0'
    || manifest.patchedDependencies?.['@wdio/tauri-service@1.2.0'] !== patch) {
    throw new Error('Tauri diagnostic backport requires the reviewed 1.2.0 pin and patch registration.')
  }
  const actual = createHash('sha256').update(readFileSync(join(frontend, patch))).digest('hex')
  if (actual !== '54edefff7804add2566587f5cd74ce442afcc229d5fbf1048d9144f2ec5a5da7') {
    throw new Error(`Tauri diagnostic patch integrity mismatch: ${actual}. Review the upstream backport before changing its checksum.`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) checkTauriDiagnosticPatch()
