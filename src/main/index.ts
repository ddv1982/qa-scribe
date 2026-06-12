import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { createDbClient } from './db/client'
import { registerIpcHandlers } from './ipc'
import { SessionService } from './services/sessionService'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 680,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`Renderer failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`)
    mainWindow?.show()
  })
  setTimeout(() => mainWindow?.show(), 3000)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function canOpenExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.qa-scribe.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const userDataPath = app.getPath('userData')
  const dbClient = createDbClient(userDataPath)
  const service = new SessionService(dbClient, join(userDataPath, 'attachments'))
  registerIpcHandlers(service)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
