import { contextBridge, ipcRenderer } from 'electron'
import type {
  BinderFile,
  DocFile,
  Manifest,
  OpenedProject,
  RecentProject,
  RichDoc,
  SaveResult,
  SnapshotFile,
  SnapshotMeta
} from '../shared/types'

const call = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

const api = {
  info: () => call<{ version: string; defaultDir: string; platform: string }>('app:info'),
  recent: () => call<RecentProject[]>('app:recent'),
  forgetRecent: (p: string) => call<void>('app:forgetRecent', p),
  showInFolder: (p: string) => call<void>('app:showInFolder', p),
  chooseFolder: (defaultPath?: string) => call<string | null>('dialog:chooseFolder', defaultPath),

  createProject: (parentDir: string, title: string, author?: string) =>
    call<OpenedProject>('project:create', parentDir, title, author),
  openProjectDialog: () => call<OpenedProject | null>('project:openDialog'),
  openProject: (p: string) => call<OpenedProject>('project:open', p),
  closeProject: (p: string) => call<void>('project:close', p),
  saveBinder: (p: string, binder: BinderFile) => call<void>('project:saveBinder', p, binder),
  saveManifest: (p: string, m: Manifest) => call<void>('project:saveManifest', p, m),
  emptyTrash: (p: string) => call<BinderFile>('project:emptyTrash', p),
  flushProject: (p: string) => call<void>('project:flush', p),

  loadDoc: (p: string, id: string) => call<DocFile>('doc:load', p, id),
  saveDoc: (p: string, id: string, content: RichDoc, t?: number) => call<SaveResult>('doc:save', p, id, content, t),
  /** Fire-and-forget copy of the text being typed, kept until the next real save (crash insurance). */
  stageDoc: (p: string, id: string, content: RichDoc, t: number) => ipcRenderer.send('doc:stage', p, id, content, t),

  listSnapshots: (p: string, id: string) => call<SnapshotMeta[]>('snap:list', p, id),
  createSnapshot: (p: string, id: string, name: string) => call<SnapshotMeta>('snap:create', p, id, name),
  getSnapshot: (p: string, id: string, snapId: string) => call<SnapshotFile>('snap:get', p, id, snapId),
  renameSnapshot: (p: string, id: string, snapId: string, name: string) =>
    call<void>('snap:rename', p, id, snapId, name),
  deleteSnapshot: (p: string, id: string, snapId: string) => call<void>('snap:delete', p, id, snapId),
  restoreSnapshot: (p: string, id: string, snapId: string) =>
    call<{ doc: DocFile; result: SaveResult }>('snap:restore', p, id, snapId),

  /** Main asks us to push unsaved edits before the window closes. */
  onFlushRequest: (fn: () => Promise<void>) => {
    ipcRenderer.on('app:flush', async () => {
      try {
        await fn()
      } finally {
        ipcRenderer.send('app:flushed')
      }
    })
  }
}

export type FoliantApi = typeof api

contextBridge.exposeInMainWorld('foliant', api)
