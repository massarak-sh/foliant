import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ProjectStore, PROJECT_EXT } from './storage/project'
import { exists, readJson, writeJsonVerified } from './storage/atomic'
import type { BinderFile, Manifest, RecentProject, RichDoc } from '../shared/types'

// Test hook: lets automated tests use a throwaway profile folder.
if (process.env.FOLIANT_USER_DATA) app.setPath('userData', process.env.FOLIANT_USER_DATA)

const stores = new Map<string, ProjectStore>()
let win: BrowserWindow | null = null
let quitting = false

function store(p: string): ProjectStore {
  const s = stores.get(p)
  if (!s) throw new Error('Project is not open')
  return s
}

// ---------- recent projects & window state ----------

const recentFile = (): string => path.join(app.getPath('userData'), 'recent.json')
const windowFile = (): string => path.join(app.getPath('userData'), 'window.json')

async function getRecent(): Promise<RecentProject[]> {
  try {
    const list = await readJson<RecentProject[]>(recentFile())
    const out: RecentProject[] = []
    for (const r of list) if (await exists(path.join(r.path, 'foliant.json'))) out.push(r)
    return out
  } catch {
    return []
  }
}

async function touchRecent(p: string, title: string): Promise<void> {
  const list = (await getRecent()).filter((r) => r.path !== p)
  list.unshift({ path: p, title, openedAt: new Date().toISOString() })
  await writeJsonVerified(recentFile(), list.slice(0, 12)).catch(() => undefined)
}

async function forgetRecent(p: string): Promise<void> {
  const list = (await getRecent()).filter((r) => r.path !== p)
  await writeJsonVerified(recentFile(), list).catch(() => undefined)
}

function defaultProjectsDir(): string {
  return path.join(app.getPath('documents'), 'Foliant')
}

// ---------- window ----------

async function createWindow(): Promise<void> {
  let bounds: { width: number; height: number; x?: number; y?: number; maximized?: boolean } = {
    width: 1360,
    height: 880
  }
  try {
    bounds = { ...bounds, ...(await readJson<typeof bounds>(windowFile())) }
  } catch {
    /* first run */
  }
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Foliant',
    backgroundColor: '#f6f3ee',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  })
  if (bounds.maximized) win.maximize()
  win.once('ready-to-show', () => win?.show())

  // Never navigate away from the app; open links in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  // Spelling suggestions in the right-click menu.
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return
    const items: Electron.MenuItemConstructorOptions[] = []
    for (const s of params.dictionarySuggestions.slice(0, 6)) {
      items.push({ label: s, click: () => win?.webContents.replaceMisspelling(s) })
    }
    if (params.misspelledWord) {
      items.push({
        label: 'Add to dictionary',
        click: () => win?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      })
      items.push({ type: 'separator' })
    }
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' })
    Menu.buildFromTemplate(items).popup()
  })

  // Before the window closes, ask the editor to hand over any unsaved text and wait for the disk.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    void shutdown()
  })

  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

async function saveWindowState(): Promise<void> {
  if (!win) return
  const b = win.getNormalBounds()
  await writeJsonVerified(windowFile(), { ...b, maximized: win.isMaximized() }).catch(() => undefined)
}

async function shutdown(): Promise<void> {
  if (!win) return
  await saveWindowState()
  // 1) Ask the renderer to push its pending edits (it replies when they are handed over).
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 8000)
    ipcMain.once('app:flushed', () => {
      clearTimeout(timer)
      resolve()
    })
    win?.webContents.send('app:flush')
  })
  // 2) Wait for every project's write queue to finish, then close cleanly.
  for (const s of stores.values()) await s.close().catch(() => undefined)
  stores.clear()
  quitting = true
  win.close()
}

// ---------- IPC ----------

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (_e, ...args) => fn(...(args as A)))
}

async function openStore(p: string) {
  const existing = stores.get(p)
  if (existing) return existing.snapshotOfState()
  const s = await ProjectStore.open(p)
  stores.set(p, s)
  await touchRecent(p, s.manifest.title)
  return s.snapshotOfState()
}

function registerIpc(): void {
  handle('app:info', () => ({
    version: app.getVersion(),
    defaultDir: defaultProjectsDir(),
    platform: process.platform
  }))
  handle('app:recent', () => getRecent())
  handle('app:forgetRecent', (p: string) => forgetRecent(p))
  handle('app:showInFolder', (p: string) => shell.openPath(p))

  handle('dialog:chooseFolder', async (defaultPath?: string) => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose where to keep the project',
      defaultPath: defaultPath || defaultProjectsDir(),
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })

  handle('project:create', async (parentDir: string, title: string, author?: string) => {
    await fs.mkdir(parentDir, { recursive: true })
    const s = await ProjectStore.create(parentDir, title, author)
    stores.set(s.root, s)
    await touchRecent(s.root, s.manifest.title)
    return s.snapshotOfState()
  })

  handle('project:openDialog', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Open a Foliant project',
      defaultPath: defaultProjectsDir(),
      buttonLabel: 'Open project',
      properties: ['openDirectory'],
      message: `Choose a project folder (it ends in ${PROJECT_EXT})`
    })
    if (r.canceled || !r.filePaths[0]) return null
    let p = r.filePaths[0]
    if (!(await exists(path.join(p, 'foliant.json')))) {
      // Allow picking the folder that contains a single project.
      const inner = (await fs.readdir(p)).filter((f) => f.endsWith(PROJECT_EXT))
      if (inner.length === 1) p = path.join(p, inner[0])
    }
    return openStore(p)
  })

  handle('project:open', (p: string) => openStore(p))

  handle('project:close', async (p: string) => {
    const s = stores.get(p)
    if (s) {
      await s.close()
      stores.delete(p)
    }
  })

  handle('project:saveBinder', (p: string, binder: BinderFile) => store(p).saveBinder(binder))
  handle('project:saveManifest', (p: string, m: Manifest) => store(p).saveManifest(m))
  handle('project:emptyTrash', (p: string) => store(p).emptyTrash())
  handle('project:flush', (p: string) => store(p).flush())

  handle('doc:load', (p: string, id: string) => store(p).loadDoc(id))
  handle('doc:save', (p: string, id: string, content: RichDoc, t?: number) => store(p).saveDoc(id, content, t))
  ipcMain.on('doc:stage', (_e, p: string, id: string, content: RichDoc, t: number) => {
    void stores.get(p)?.stage(id, content, t).catch(() => undefined)
  })

  handle('snap:list', (p: string, id: string) => store(p).listSnapshots(id))
  handle('snap:create', (p: string, id: string, name: string) => store(p).createSnapshot(id, name))
  handle('snap:get', (p: string, id: string, snapId: string) => store(p).getSnapshot(id, snapId))
  handle('snap:rename', (p: string, id: string, snapId: string, name: string) =>
    store(p).renameSnapshot(id, snapId, name)
  )
  handle('snap:delete', (p: string, id: string, snapId: string) => store(p).deleteSnapshot(id, snapId))
  handle('snap:restore', (p: string, id: string, snapId: string) => store(p).restoreSnapshot(id, snapId))
}

// ---------- app ----------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    registerIpc()
    await createWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
