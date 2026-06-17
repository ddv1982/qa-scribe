import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Electrobun, { ApplicationMenu, BrowserWindow, Screen, Utils } from 'electrobun/bun'
import type { ApplicationMenuItemConfig, Display, Rectangle } from 'electrobun/bun'
import { createDbClient } from '../main/db/client'
import { SessionService } from '../main/services/sessionService'
import { createQaScribeRpc } from './rpc'

type StoredWindowBounds = Pick<Rectangle, 'x' | 'y' | 'width' | 'height'>

let mainWindow: BrowserWindow | null = null
let windowStatePath: string | null = null
let windowStateTimer: ReturnType<typeof setTimeout> | null = null

const defaultWindowBounds = {
  width: 1280,
  height: 860
}

const minimumWindowBounds = {
  width: 640,
  height: 520
}

const appName = 'qa-scribe'
const userDataPath = Utils.paths.userData
windowStatePath = join(userDataPath, 'window-state.json')

const dbClient = createDbClient(userDataPath)
const service = new SessionService(dbClient, join(userDataPath, 'attachments'))

installApplicationMenu()
createWindow()

Electrobun.events.on('reopen', () => {
  if (!mainWindow) createWindow()
})

function createWindow(): void {
  const savedBounds = windowStatePath ? loadWindowBounds(windowStatePath) : null
  const window = new BrowserWindow({
    title: appName,
    frame: savedBounds ?? defaultWindowFrame(),
    url: 'views://mainview/index.html',
    html: null,
    preload: null,
    viewsRoot: null,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    hidden: true,
    sandbox: false,
    rpc: createQaScribeRpc(service)
  })

  mainWindow = window
  persistWindowBounds(window)
  window.webview.on('dom-ready', () => window.show())
  const onWebviewEvent = window.webview.on.bind(window.webview) as (name: string, handler: (event: unknown) => void) => void
  onWebviewEvent('new-window-open', (event) => {
    const url = extractEventUrl(event)
    if (url && canOpenExternalUrl(url)) Utils.openExternal(url)
  })
  setTimeout(() => window.show(), 3000)
}

function defaultWindowFrame(): StoredWindowBounds {
  const display = Screen.getPrimaryDisplay()
  const workArea = normalizedWorkArea(display)
  return {
    x: workArea.x + Math.max(0, Math.round((workArea.width - defaultWindowBounds.width) / 2)),
    y: workArea.y + Math.max(0, Math.round((workArea.height - defaultWindowBounds.height) / 2)),
    ...defaultWindowBounds
  }
}

function installApplicationMenu(): void {
  const appMenu: ApplicationMenuItemConfig = {
    label: appName,
    submenu: [
      { role: 'about' },
      { type: 'divider' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'showAll' },
      { type: 'divider' },
      { role: 'quit' }
    ]
  }

  const viewMenu: ApplicationMenuItemConfig = {
    label: 'View',
    submenu: [{ role: 'toggleFullScreen' }]
  }

  const fileMenu: ApplicationMenuItemConfig = {
    label: 'File',
    submenu:
      process.platform === 'darwin'
        ? [{ role: 'close' }]
        : [{ role: 'close' }, { type: 'divider' }, { role: 'quit' }]
  }

  const editMenu: ApplicationMenuItemConfig = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'divider' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { type: 'divider' },
      { role: 'selectAll' }
    ]
  }

  const windowMenu: ApplicationMenuItemConfig = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'divider' },
      { role: 'bringAllToFront' }
    ]
  }

  const menu =
    process.platform === 'darwin'
      ? [appMenu, fileMenu, editMenu, viewMenu, windowMenu]
      : [fileMenu, editMenu, viewMenu, windowMenu]

  ApplicationMenu.setApplicationMenu(menu)
}

function canOpenExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function extractEventUrl(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null
  const detail = 'data' in event ? (event as { data?: unknown }).data : event
  if (!detail || typeof detail !== 'object') return null
  const maybeUrl = (detail as { url?: unknown; detail?: unknown }).url
  if (typeof maybeUrl === 'string') return maybeUrl

  const nestedDetail = (detail as { detail?: unknown }).detail
  if (!nestedDetail || typeof nestedDetail !== 'object') return null
  const nestedUrl = (nestedDetail as { url?: unknown }).url
  return typeof nestedUrl === 'string' ? nestedUrl : null
}

function loadWindowBounds(path: string): StoredWindowBounds | null {
  if (!existsSync(path)) return null

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredWindowBounds>
    if (!isValidWindowBounds(parsed)) return null
    return fitWindowBoundsToDisplay(parsed)
  } catch {
    return null
  }
}

function isValidWindowBounds(value: Partial<StoredWindowBounds>): value is StoredWindowBounds {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    Number(value.width) > 0 &&
    Number(value.height) > 0
  )
}

function fitWindowBoundsToDisplay(bounds: StoredWindowBounds): StoredWindowBounds {
  const display = getBestDisplay(bounds)
  const { workArea } = display
  const width = Math.min(
    Math.max(Math.round(bounds.width), minimumWindowBounds.width),
    Math.max(workArea.width, minimumWindowBounds.width)
  )
  const height = Math.min(
    Math.max(Math.round(bounds.height), minimumWindowBounds.height),
    Math.max(workArea.height, minimumWindowBounds.height)
  )
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height

  return {
    x: clamp(Math.round(bounds.x), workArea.x, maxX),
    y: clamp(Math.round(bounds.y), workArea.y, maxY),
    width,
    height
  }
}

function getBestDisplay(bounds: StoredWindowBounds): Display {
  const displays = Screen.getAllDisplays()
  const primaryDisplay = Screen.getPrimaryDisplay()
  if (displays.length === 0) return normalizedDisplay(primaryDisplay)

  const [bestDisplay] = displays
    .map((display) => normalizedDisplay(display))
    .map((display) => ({ display, area: intersectionArea(bounds, display.workArea) }))
    .sort((a, b) => b.area - a.area)

  return bestDisplay && bestDisplay.area > 0 ? bestDisplay.display : normalizedDisplay(primaryDisplay)
}

function normalizedDisplay(display: Display): Display {
  return {
    ...display,
    workArea: normalizedWorkArea(display)
  }
}

function normalizedWorkArea(display: Display): Rectangle {
  if (display.workArea.width > 0 && display.workArea.height > 0) return display.workArea
  return {
    x: 0,
    y: 0,
    width: defaultWindowBounds.width,
    height: defaultWindowBounds.height
  }
}

function intersectionArea(a: StoredWindowBounds, b: Rectangle): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return xOverlap * yOverlap
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function persistWindowBounds(window: BrowserWindow): void {
  if (!windowStatePath) return

  const scheduleSave = (): void => {
    if (window.isMinimized() || window.isFullScreen()) return
    if (windowStateTimer) clearTimeout(windowStateTimer)
    windowStateTimer = setTimeout(() => saveWindowBounds(window), 250)
  }

  window.on('move', scheduleSave)
  window.on('resize', scheduleSave)
  window.on('close', () => {
    if (windowStateTimer) clearTimeout(windowStateTimer)
    saveWindowBounds(window)
    if (mainWindow === window) mainWindow = null
    if (process.platform !== 'darwin') Utils.quit()
  })
}

function saveWindowBounds(window: BrowserWindow): void {
  if (!windowStatePath || window.isMinimized() || window.isFullScreen()) return
  const bounds = window.getFrame()
  mkdirSync(dirname(windowStatePath), { recursive: true })
  writeFileSync(windowStatePath, `${JSON.stringify(bounds, null, 2)}\n`)
}
