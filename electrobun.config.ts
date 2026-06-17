import { readFileSync } from 'node:fs'
import type { ElectrobunConfig } from 'electrobun/bun'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
  description?: string
}

export default {
  app: {
    name: 'qa-scribe',
    identifier: 'com.qa-scribe.app',
    version: packageJson.version,
    description: packageJson.description
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts'
    },
    views: {
      mainview: {
        entrypoint: 'src/renderer-view/main.ts'
      }
    },
    copy: {
      'src/renderer/index.html': 'views/mainview/index.html'
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: 'cef'
    },
    mac: {
      codesign: false,
      notarize: false
    }
  },
  runtime: {
    exitOnLastWindowClosed: false
  },
  release: {
    baseUrl: '',
    generatePatch: false
  }
} satisfies ElectrobunConfig
