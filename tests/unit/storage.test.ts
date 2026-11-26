import { describe, expect, it, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProjectStore } from '../../src/main/storage/project'
import { sha256, writeFileVerified } from '../../src/main/storage/atomic'
import type { RichDoc } from '../../src/shared/types'

const para = (...texts: string[]): RichDoc => ({
  type: 'doc',
  content: texts.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] }))
})

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'foliant-test-'))
})

describe('verified atomic writes', () => {
  it('writes and leaves no temp files', async () => {
    const f = path.join(dir, 'a.json')
    await writeFileVerified(f, 'hello')
    await writeFileVerified(f, 'world')
    expect(await fs.readFile(f, 'utf8')).toBe('world')
    expect((await fs.readdir(dir)).filter((x) => x.endsWith('.tmp'))).toEqual([])
  })
})

describe('ProjectStore', () => {
  it('creates a project with a chapter, a scene and default settings', async () => {
    const s = await ProjectStore.create(dir, 'My Novel')
    expect(path.basename(s.root)).toBe('My Novel.foliant')
    expect(s.manifest.settings.text).toMatchObject({ fontFamily: 'EB Garamond', fontSizePt: 12, lineSpacing: 1.1 })
    expect(s.binder.manuscript[0].kind).toBe('chapter')
    expect(s.binder.manuscript[0].children[0].kind).toBe('scene')
    // Same title again gets a new folder, never overwrites.
    const s2 = await ProjectStore.create(dir, 'My Novel')
    expect(path.basename(s2.root)).toBe('My Novel (2).foliant')
  })

  it('saves, reopens and counts words', async () => {
    const s = await ProjectStore.create(dir, 'Book')
    const sceneId = s.binder.manuscript[0].children[0].id
    const r = await s.saveDoc(sceneId, para('The quick brown fox.', 'Jumps over.'))
    expect(r.ok).toBe(true)
    expect(r.words).toBe(6)
    expect(r.added).toBe(6)
    await s.close()
    const again = await ProjectStore.open(s.root)
    const doc = await again.loadDoc(sceneId)
    expect(doc.words).toBe(6)
    expect(again.snapshotOfState().counts[sceneId].words).toBe(6)
  })

  it('tracks words added and removed for the day', async () => {
    const s = await ProjectStore.create(dir, 'Book')
    const id = s.binder.manuscript[0].children[0].id
    await s.saveDoc(id, para('one two three four'))
    const r = await s.saveDoc(id, para('one three four five six'))
    expect(r.added).toBe(2)
    expect(r.removed).toBe(1)
    expect(r.today).toMatchObject({ added: 6, removed: 1, total: 5 })
  })

  it('recovers an edit that was journaled but never reached its file (crash)', async () => {
    const s = await ProjectStore.create(dir, 'Book')
    const id = s.binder.manuscript[0].children[0].id
    await s.saveDoc(id, para('Saved text.'))
    // Simulate a crash: the journal got the new version but the doc file write never happened.
    const newer = { formatVersion: 1, id, lang: 'primary', content: para('Newer text that was being saved.'), words: 6, chars: 30, modified: new Date().toISOString() }
    const data = JSON.stringify(newer)
    await fs.appendFile(path.join(s.root, '.journal/journal.log'), JSON.stringify({ t: '', file: `docs/${id}.json`, sha: sha256(data), data }) + '\n')
    // And a torn half-line after it.
    await fs.appendFile(path.join(s.root, '.journal/journal.log'), '{"t":"x","file":"docs/')
    const reopened = await ProjectStore.open(s.root)
    expect(reopened.recovered).toEqual([id])
    expect((await reopened.loadDoc(id)).words).toBe(6)
    expect((await fs.stat(path.join(s.root, '.journal/journal.log'))).size).toBe(0)
  })

  it('falls back to a backup if a file is damaged', async () => {
    const s = await ProjectStore.create(dir, 'Book')
    await s.close()
    // Damage binder.json; the first save created a backup? Not yet — make one by saving again later.
    const s2 = await ProjectStore.open(s.root)
    await s2.saveBinder(s2.binder) // first write in this session backs up the previous file
    await s2.close()
    await fs.writeFile(path.join(s.root, 'binder.json'), '{"broken')
    const s3 = await ProjectStore.open(s.root)
    expect(s3.binder.manuscript[0].title).toBe('Chapter 1')
  })

  it('snapshots: create, list, restore (with automatic safety snapshot), delete', async () => {
    const s = await ProjectStore.create(dir, 'Book')
    const id = s.binder.manuscript[0].children[0].id
    await s.saveDoc(id, para('First draft.'))
    const snap = await s.createSnapshot(id, 'Draft 1')
    await s.saveDoc(id, para('Second draft, much better.'))
    let list = await s.listSnapshots(id)
    expect(list.map((x) => x.name)).toEqual(['Draft 1'])
    const { doc } = await s.restoreSnapshot(id, snap.id)
    expect(doc.words).toBe(2)
    list = await s.listSnapshots(id)
    expect(list.length).toBe(2)
    const safety = list.find((x) => x.reason === 'auto-before-restore')!
    expect(safety.words).toBe(4)
    await s.deleteSnapshot(id, snap.id)
    expect((await s.listSnapshots(id)).length).toBe(1)
    // A deleted snapshot must not come back from the journal after a crash.
    const reopened = await ProjectStore.open(s.root)
    expect((await reopened.listSnapshots(id)).length).toBe(1)
  })

  it('serializes concurrent saves so the last one wins', async () => {
    const s = await ProjectStore.create(dir, 'Book')
    const id = s.binder.manuscript[0].children[0].id
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.saveDoc(id, para(`version ${i}`))))
    const doc = await s.loadDoc(id)
    expect(JSON.stringify(doc.content)).toContain('version 19')
  })

  it('rejects ids that try to escape the project folder', async () => {
    const s = await ProjectStore.create(dir, 'Book')
    await expect(s.loadDoc('../../etc/passwd')).rejects.toThrow()
  })
})
