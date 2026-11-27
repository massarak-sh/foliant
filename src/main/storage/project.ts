import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { appendDurable, exists, readJson, sha256, writeFileVerified, writeJsonVerified } from './atomic'
import { countChars, countWords, dayKey, docToText, emptyDoc, wordDelta } from '../../shared/text'
import { allItems, makeItem, walk } from '../../shared/binder'
import {
  DEFAULT_SETTINGS,
  FORMAT_VERSION,
  type BinderFile,
  type DayStats,
  type DocFile,
  type Manifest,
  type OpenedProject,
  type RichDoc,
  type SaveResult,
  type SnapshotFile,
  type SnapshotMeta,
  type StatsFile
} from '../../shared/types'

export const PROJECT_EXT = '.foliant'
const JOURNAL = '.journal/journal.log'
const JOURNAL_COMPACT_BYTES = 2 * 1024 * 1024
const BACKUP_EVERY_MS = 10 * 60 * 1000
const BACKUPS_KEPT = 30

interface JournalEntry {
  t: string
  file: string
  sha: string
  data: string
  /** The file was deliberately removed. */
  deleted?: boolean
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim()
  return cleaned.slice(0, 80) || 'Untitled'
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-')
}

function isId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

/**
 * One open project on disk. All writes go through a single queue, so they never interleave,
 * and every write is journaled first, then written atomically and verified.
 */
export class ProjectStore {
  readonly root: string
  manifest!: Manifest
  binder!: BinderFile
  stats!: StatsFile
  /** Plain text of the last saved version of each doc (for added/removed counting). */
  private texts = new Map<string, string>()
  private counts: Record<string, { words: number; chars: number }> = {}
  private queue: Promise<unknown> = Promise.resolve()
  private lastBackup = new Map<string, number>()
  recovered: string[] = []

  private constructor(root: string) {
    this.root = root
  }

  // ---------- lifecycle ----------

  static async create(parentDir: string, title: string, author?: string): Promise<ProjectStore> {
    const base = safeFileName(title)
    let root = path.join(parentDir, base + PROJECT_EXT)
    for (let i = 2; await exists(root); i++) root = path.join(parentDir, `${base} (${i})${PROJECT_EXT}`)
    await fs.mkdir(root, { recursive: true })
    const now = new Date().toISOString()
    const store = new ProjectStore(root)
    store.manifest = {
      formatVersion: FORMAT_VERSION,
      app: 'Foliant',
      id: randomBytes(8).toString('hex'),
      title: title.trim() || 'Untitled',
      author,
      created: now,
      modified: now,
      settings: structuredClone(DEFAULT_SETTINGS),
      languages: [{ code: 'primary', name: 'Original' }]
    }
    const chapter = makeItem('chapter', 'Chapter 1')
    const scene = makeItem('scene', 'Scene 1')
    chapter.children.push(scene)
    store.binder = { formatVersion: FORMAT_VERSION, manuscript: [chapter], research: [], trash: [] }
    store.stats = { formatVersion: FORMAT_VERSION, days: {} }
    for (const d of ['docs', 'snapshots', 'notes', 'comments', 'stats', '.journal', '.backups']) {
      await fs.mkdir(path.join(root, d), { recursive: true })
    }
    await writeJsonVerified(path.join(root, 'foliant.json'), store.manifest)
    await writeJsonVerified(path.join(root, 'binder.json'), store.binder)
    await writeJsonVerified(path.join(root, 'stats/days.json'), store.stats)
    for (const it of allItems(store.binder)) await store.writeDoc(it.id, emptyDoc())
    await fs.writeFile(
      path.join(root, 'README.txt'),
      'This folder is a Foliant project. Open it with Foliant (File > Open project).\r\n' +
        'Your text is in the "docs" folder as JSON files, snapshots are in "snapshots".\r\n' +
        'Please do not edit files here by hand while Foliant has the project open.\r\n'
    )
    return store
  }

  static async open(root: string): Promise<ProjectStore> {
    if (!(await exists(path.join(root, 'foliant.json')))) {
      throw new Error('This folder is not a Foliant project (foliant.json is missing).')
    }
    const store = new ProjectStore(root)
    // Replay edits that were journaled but may not have reached their file (crash, power loss).
    store.recovered = await store.replayJournal()
    store.manifest = await store.readWithFallback<Manifest>('foliant.json')
    if (store.manifest.formatVersion > FORMAT_VERSION) {
      throw new Error('This project was saved by a newer version of Foliant. Please update Foliant.')
    }
    store.manifest.settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...store.manifest.settings,
      text: { ...DEFAULT_SETTINGS.text, ...store.manifest.settings?.text },
      page: { ...DEFAULT_SETTINGS.page, ...store.manifest.settings?.page }
    }
    store.binder = await store.readWithFallback<BinderFile>('binder.json')
    store.binder.research ??= []
    store.binder.trash ??= []
    if (store.binder.research.length) {
      // The separate "Notes & research" area was removed; keep anything that was there in the trash.
      store.binder.trash.unshift(...store.binder.research)
      store.binder.research = []
      await store.commitJson('binder.json', store.binder)
    }
    store.stats = (await exists(path.join(root, 'stats/days.json')))
      ? await store.readWithFallback<StatsFile>('stats/days.json')
      : { formatVersion: FORMAT_VERSION, days: {} }
    for (const it of allItems(store.binder)) {
      const doc = await store.loadDoc(it.id)
      const text = docToText(doc.content)
      store.texts.set(it.id, text)
      store.counts[it.id] = { words: doc.words, chars: doc.chars }
    }
    // Then apply edits that were still being typed when the app went down (never reached a save).
    for (const id of await store.applyStaged()) if (!store.recovered.includes(id)) store.recovered.push(id)
    return store
  }

  // ---------- staging: the very latest keystrokes ----------
  // The editor saves after a short pause in typing. In between, it streams the current text here,
  // and we keep it in .journal/staged/<id>.json. If the app crashes before the real save, the staged
  // text is applied the next time the project opens.

  private stageChains = new Map<string, Promise<unknown>>()
  private stagedAt = new Map<string, number>()

  private stagedFile(id: string): string {
    if (!isId(id)) throw new Error(`Invalid id ${id}`)
    return this.abs(path.join('.journal', 'staged', `${id}.json`))
  }

  private chainStage(id: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.stageChains.get(id) ?? Promise.resolve()
    const next = prev.then(fn, fn).catch(() => undefined)
    this.stageChains.set(id, next)
    return next
  }

  stage(id: string, content: RichDoc, t: number): Promise<void> {
    const file = this.stagedFile(id)
    this.stagedAt.set(id, t)
    return this.chainStage(id, async () => {
      if ((this.stagedAt.get(id) ?? 0) !== t) return // a newer version is already queued
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, JSON.stringify({ t, content }))
    })
  }

  private clearStaged(id: string, upTo: number): Promise<void> {
    return this.chainStage(id, async () => {
      if ((this.stagedAt.get(id) ?? 0) > upTo) return // newer keystrokes arrived meanwhile
      this.stagedAt.delete(id)
      await fs.rm(this.stagedFile(id), { force: true })
    })
  }

  private async applyStaged(): Promise<string[]> {
    const dir = this.abs(path.join('.journal', 'staged'))
    if (!(await exists(dir))) return []
    const out: string[] = []
    for (const f of await fs.readdir(dir)) {
      const id = f.replace(/\.json$/, '')
      if (!f.endsWith('.json') || !isId(id)) continue
      try {
        const st = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as { t: number; content: RichDoc }
        const onDisk = await this.loadDoc(id)
        const diskT = onDisk.modified ? Date.parse(onDisk.modified) : 0
        const known = allItems(this.binder).some((i) => i.id === id)
        if (known && st.content?.type === 'doc' && st.t > diskT) {
          const r = await this.saveDoc(id, st.content)
          if (r.ok) out.push(id)
          else continue // keep the staged file; try again next time
        }
        await fs.rm(path.join(dir, f), { force: true })
      } catch {
        /* unreadable (torn) staged file: the real save is intact, drop it */
        await fs.rm(path.join(dir, f), { force: true }).catch(() => undefined)
      }
    }
    return out
  }

  snapshotOfState(): OpenedProject {
    return {
      path: this.root,
      manifest: this.manifest,
      binder: this.binder,
      counts: { ...this.counts },
      stats: this.stats,
      recovered: this.recovered
    }
  }

  /** Wait for all queued writes, then clear the journal. */
  async close(): Promise<void> {
    await Promise.all(this.stageChains.values())
    await this.enqueue(async () => {
      await this.compactJournal(true)
    })
  }

  flush(): Promise<unknown> {
    return this.enqueue(async () => undefined)
  }

  // ---------- core write path ----------

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private abs(rel: string): string {
    return path.join(this.root, rel)
  }

  /** Journal → backup → verified atomic write. */
  private async commit(rel: string, data: string): Promise<void> {
    const entry: JournalEntry = { t: new Date().toISOString(), file: rel, sha: sha256(data), data }
    await appendDurable(this.abs(JOURNAL), JSON.stringify(entry) + '\n')
    await this.maybeBackup(rel)
    await writeFileVerified(this.abs(rel), data)
    await this.compactJournal(false)
  }

  private async remove(rel: string): Promise<void> {
    const entry: JournalEntry = { t: new Date().toISOString(), file: rel, sha: sha256(''), data: '', deleted: true }
    await appendDurable(this.abs(JOURNAL), JSON.stringify(entry) + '\n')
    await fs.rm(this.abs(rel), { force: true })
  }

  private async commitJson(rel: string, value: unknown): Promise<void> {
    await this.commit(rel, JSON.stringify(value, null, 1) + '\n')
  }

  private async maybeBackup(rel: string): Promise<void> {
    const now = Date.now()
    if (now - (this.lastBackup.get(rel) ?? 0) < BACKUP_EVERY_MS) return
    const src = this.abs(rel)
    if (!(await exists(src))) return
    this.lastBackup.set(rel, now)
    const dir = this.abs(path.join('.backups', rel.replace(/[\\/]/g, '__')))
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(src, path.join(dir, `${stamp()}.json`))
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort()
    for (const f of files.slice(0, Math.max(0, files.length - BACKUPS_KEPT))) {
      await fs.rm(path.join(dir, f), { force: true })
    }
  }

  /** Read a JSON file; if it is damaged, fall back to the newest good backup. */
  private async readWithFallback<T>(rel: string): Promise<T> {
    try {
      return await readJson<T>(this.abs(rel))
    } catch (err) {
      const dir = this.abs(path.join('.backups', rel.replace(/[\\/]/g, '__')))
      const files = (await exists(dir)) ? (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort().reverse() : []
      for (const f of files) {
        try {
          const value = await readJson<T>(path.join(dir, f))
          await writeJsonVerified(this.abs(rel), value)
          return value
        } catch {
          /* try older */
        }
      }
      throw err
    }
  }

  private async readJournal(): Promise<JournalEntry[]> {
    const file = this.abs(JOURNAL)
    if (!(await exists(file))) return []
    const raw = await fs.readFile(file, 'utf8')
    const out: JournalEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as JournalEntry
        // A torn last line (power cut mid-append) fails to parse or fails its checksum: skip it.
        if (e.file && typeof e.data === 'string' && sha256(e.data) === e.sha) out.push(e)
      } catch {
        /* torn line */
      }
    }
    return out
  }

  private async replayJournal(): Promise<string[]> {
    const entries = await this.readJournal()
    const latest = new Map<string, JournalEntry>()
    for (const e of entries) latest.set(e.file, e)
    const recovered: string[] = []
    for (const [rel, e] of latest) {
      if (rel.includes('..') || path.isAbsolute(rel)) continue
      if (e.deleted) {
        await fs.rm(this.abs(rel), { force: true })
        continue
      }
      let current: string | null = null
      try {
        current = await fs.readFile(this.abs(rel), 'utf8')
      } catch {
        current = null
      }
      if (current !== null && sha256(current) === e.sha) continue
      await writeFileVerified(this.abs(rel), e.data)
      const m = /^docs\/([^/@]+)\.json$/.exec(rel.replace(/\\/g, '/'))
      if (m) recovered.push(m[1])
    }
    await this.compactJournal(true)
    return recovered
  }

  /** Every journal entry has been committed by the time this runs (writes are serialized). */
  private async compactJournal(force: boolean): Promise<void> {
    const file = this.abs(JOURNAL)
    try {
      const st = await fs.stat(file)
      if (force || st.size > JOURNAL_COMPACT_BYTES) await fs.truncate(file, 0)
    } catch {
      /* no journal yet */
    }
  }

  // ---------- documents ----------

  private docRel(id: string): string {
    if (!isId(id)) throw new Error(`Invalid id ${id}`)
    return `docs/${id}.json`
  }

  private async writeDoc(id: string, content: RichDoc): Promise<DocFile> {
    const text = docToText(content)
    const doc: DocFile = {
      formatVersion: FORMAT_VERSION,
      id,
      lang: 'primary',
      content,
      words: countWords(text),
      chars: countChars(text),
      modified: new Date().toISOString()
    }
    await this.commitJson(this.docRel(id), doc)
    this.texts.set(id, text)
    this.counts[id] = { words: doc.words, chars: doc.chars }
    return doc
  }

  async loadDoc(id: string): Promise<DocFile> {
    const rel = this.docRel(id)
    if (!(await exists(this.abs(rel)))) {
      return { formatVersion: FORMAT_VERSION, id, lang: 'primary', content: emptyDoc(), words: 0, chars: 0, modified: '' }
    }
    return this.readWithFallback<DocFile>(rel)
  }

  /** `t` = when the editor captured this content (ms); used to clear the matching staged copy. */
  saveDoc(id: string, content: RichDoc, t?: number): Promise<SaveResult> {
    return this.enqueue(async () => {
      const before = this.texts.get(id) ?? ''
      const after = docToText(content)
      const delta = wordDelta(before, after)
      try {
        const doc = await this.writeDoc(id, content)
        const today = await this.recordStats(id, delta)
        if (t !== undefined) void this.clearStaged(id, t)
        return { ok: true, savedAt: doc.modified, words: doc.words, chars: doc.chars, ...delta, today }
      } catch (err) {
        return {
          ok: false,
          error: (err as Error).message,
          words: countWords(after),
          chars: countChars(after),
          added: 0,
          removed: 0,
          today: this.today()
        }
      }
    })
  }

  private today(): DayStats {
    return this.stats.days[dayKey()] ?? { added: 0, removed: 0, total: this.manuscriptTotal() }
  }

  private manuscriptTotal(): number {
    let n = 0
    for (const it of walk(this.binder.manuscript)) n += this.counts[it.id]?.words ?? 0
    return n
  }

  private isTrashed(id: string): boolean {
    for (const it of walk(this.binder.trash)) if (it.id === id) return true
    return false
  }

  private async recordStats(id: string, delta: { added: number; removed: number }): Promise<DayStats> {
    const key = dayKey()
    const day = this.stats.days[key] ?? { added: 0, removed: 0, total: 0 }
    if (!this.isTrashed(id)) {
      day.added += delta.added
      day.removed += delta.removed
    }
    day.total = this.manuscriptTotal()
    this.stats.days[key] = day
    await this.commitJson('stats/days.json', this.stats)
    return { ...day }
  }

  // ---------- binder & manifest ----------

  saveBinder(binder: BinderFile): Promise<void> {
    return this.enqueue(async () => {
      // Make sure every item has a doc file.
      for (const it of allItems(binder)) {
        if (!this.counts[it.id] && !(await exists(this.abs(this.docRel(it.id))))) {
          await this.writeDoc(it.id, emptyDoc())
        }
      }
      binder.formatVersion = FORMAT_VERSION
      await this.commitJson('binder.json', binder)
      this.binder = binder
    })
  }

  saveManifest(manifest: Manifest): Promise<void> {
    return this.enqueue(async () => {
      manifest.modified = new Date().toISOString()
      await this.commitJson('foliant.json', manifest)
      this.manifest = manifest
    })
  }

  /** Permanently delete trashed items' files (snapshots are kept unless asked). */
  emptyTrash(): Promise<BinderFile> {
    return this.enqueue(async () => {
      const ids = [...walk(this.binder.trash)].map((i) => i.id)
      const binder = { ...this.binder, trash: [] }
      await this.commitJson('binder.json', binder)
      this.binder = binder
      for (const id of ids) {
        const rel = this.docRel(id)
        // Keep one last copy in .backups before deleting.
        this.lastBackup.delete(rel)
        await this.maybeBackup(rel)
        await this.remove(rel)
        delete this.counts[id]
        this.texts.delete(id)
      }
      return binder
    })
  }

  // ---------- snapshots ----------

  private snapDir(docId: string): string {
    if (!isId(docId)) throw new Error(`Invalid id ${docId}`)
    return this.abs(path.join('snapshots', docId))
  }

  async listSnapshots(docId: string): Promise<SnapshotMeta[]> {
    const dir = this.snapDir(docId)
    if (!(await exists(dir))) return []
    const out: SnapshotMeta[] = []
    for (const f of (await fs.readdir(dir)).filter((f) => f.endsWith('.json'))) {
      try {
        const s = await readJson<SnapshotFile>(path.join(dir, f))
        out.push({ id: s.id, docId: s.docId, name: s.name, created: s.created, words: s.words, reason: s.reason })
      } catch {
        /* skip damaged */
      }
    }
    return out.sort((a, b) => b.created.localeCompare(a.created))
  }

  createSnapshot(docId: string, name: string, reason = 'manual', content?: RichDoc): Promise<SnapshotMeta> {
    return this.enqueue(async () => {
      const body = content ?? (await this.loadDoc(docId)).content
      const created = new Date().toISOString()
      const id = `${stamp(new Date(created))}-${randomBytes(3).toString('hex')}`
      const snap: SnapshotFile = {
        formatVersion: FORMAT_VERSION,
        id,
        docId,
        name: name.trim() || 'Untitled snapshot',
        created,
        words: countWords(docToText(body)),
        reason,
        content: body
      }
      await this.commitJson(path.join('snapshots', docId, `${id}.json`).replace(/\\/g, '/'), snap)
      const { content: _c, formatVersion: _f, ...meta } = snap
      return meta
    })
  }

  async getSnapshot(docId: string, snapId: string): Promise<SnapshotFile> {
    if (!isId(snapId)) throw new Error('Invalid snapshot id')
    return readJson<SnapshotFile>(path.join(this.snapDir(docId), `${snapId}.json`))
  }

  async renameSnapshot(docId: string, snapId: string, name: string): Promise<void> {
    const snap = await this.getSnapshot(docId, snapId)
    snap.name = name.trim() || snap.name
    await this.enqueue(() => this.commitJson(`snapshots/${docId}/${snapId}.json`, snap))
  }

  async deleteSnapshot(docId: string, snapId: string): Promise<void> {
    if (!isId(snapId)) throw new Error('Invalid snapshot id')
    this.snapDir(docId)
    await this.enqueue(() => this.remove(`snapshots/${docId}/${snapId}.json`))
  }

  /** Restore a snapshot. The current text is snapshotted first, so a restore can always be undone. */
  async restoreSnapshot(docId: string, snapId: string): Promise<{ doc: DocFile; result: SaveResult }> {
    const snap = await this.getSnapshot(docId, snapId)
    await this.createSnapshot(docId, `Before restoring “${snap.name}”`, 'auto-before-restore')
    const result = await this.saveDoc(docId, snap.content)
    if (!result.ok) throw new Error(result.error)
    return { doc: await this.loadDoc(docId), result }
  }
}
