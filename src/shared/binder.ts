import type { BinderFile, BinderItem, ItemKind } from './types'

/** Binder areas. Items can move freely between manuscript and research; trash holds deleted items. */
export type Area = 'manuscript' | 'research' | 'trash'
export const AREAS: Area[] = ['manuscript', 'research', 'trash']

export function newId(): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
  return `${Date.now().toString(36)}${rnd}`.slice(0, 20)
}

export function makeItem(kind: ItemKind, title: string): BinderItem {
  const now = new Date().toISOString()
  return { id: newId(), kind, title, children: [], created: now, modified: now }
}

export interface Location {
  area: Area
  parentId: string | null
  index: number
}

export function clone(binder: BinderFile): BinderFile {
  return structuredClone(binder)
}

export function* walk(items: BinderItem[]): Generator<BinderItem> {
  for (const it of items) {
    yield it
    yield* walk(it.children)
  }
}

export function allItems(binder: BinderFile): BinderItem[] {
  return AREAS.flatMap((a) => [...walk(binder[a])])
}

export function findItem(binder: BinderFile, id: string): BinderItem | undefined {
  for (const a of AREAS) for (const it of walk(binder[a])) if (it.id === id) return it
  return undefined
}

export function locate(binder: BinderFile, id: string): Location | undefined {
  const search = (items: BinderItem[], area: Area, parentId: string | null): Location | undefined => {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) return { area, parentId, index: i }
      const r = search(items[i].children, area, items[i].id)
      if (r) return r
    }
    return undefined
  }
  for (const a of AREAS) {
    const r = search(binder[a], a, null)
    if (r) return r
  }
  return undefined
}

function siblings(binder: BinderFile, area: Area, parentId: string | null): BinderItem[] {
  if (parentId === null) return binder[area]
  const parent = findItem(binder, parentId)
  if (!parent) throw new Error(`No binder item ${parentId}`)
  return parent.children
}

export function isDescendant(item: BinderItem, maybeChildId: string): boolean {
  for (const c of walk(item.children)) if (c.id === maybeChildId) return true
  return false
}

/** Remove an item (with its children) and return it. */
export function detach(binder: BinderFile, id: string): BinderItem {
  const loc = locate(binder, id)
  if (!loc) throw new Error(`No binder item ${id}`)
  const list = siblings(binder, loc.area, loc.parentId)
  const [item] = list.splice(loc.index, 1)
  return item
}

export function insert(binder: BinderFile, item: BinderItem, to: Location): void {
  const list = siblings(binder, to.area, to.parentId)
  const index = Math.max(0, Math.min(to.index, list.length))
  list.splice(index, 0, item)
}

export type DropPosition = 'before' | 'after' | 'inside'

/** Move `id` relative to `targetId`. Returns a new binder, or the same one if the move is impossible. */
export function moveItem(binder: BinderFile, id: string, targetId: string, pos: DropPosition): BinderFile {
  if (id === targetId) return binder
  const b = clone(binder)
  const item = findItem(b, id)
  if (!item || isDescendant(item, targetId)) return binder
  detach(b, id)
  const tloc = locate(b, targetId)
  if (!tloc) return binder
  if (pos === 'inside') {
    const target = findItem(b, targetId)!
    target.collapsed = false
    target.children.push(item)
  } else {
    insert(b, item, { ...tloc, index: tloc.index + (pos === 'after' ? 1 : 0) })
  }
  return b
}

/** Move to the end of an area's top level (used when dropping on an area header). */
export function moveToArea(binder: BinderFile, id: string, area: Area): BinderFile {
  const b = clone(binder)
  const item = detach(b, id)
  b[area].push(item)
  return b
}

/** Make an item a child of the sibling above it. */
export function indent(binder: BinderFile, id: string): BinderFile {
  const loc = locate(binder, id)
  if (!loc || loc.index === 0) return binder
  const b = clone(binder)
  const list = siblings(b, loc.area, loc.parentId)
  const prev = list[loc.index - 1]
  const [item] = list.splice(loc.index, 1)
  prev.children.push(item)
  prev.collapsed = false
  return b
}

/** Move an item out of its parent, right after the parent. */
export function outdent(binder: BinderFile, id: string): BinderFile {
  const loc = locate(binder, id)
  if (!loc || loc.parentId === null) return binder
  const b = clone(binder)
  const ploc = locate(b, loc.parentId)!
  const item = detach(b, id)
  insert(b, item, { ...ploc, index: ploc.index + 1 })
  return b
}

export function moveUpDown(binder: BinderFile, id: string, dir: -1 | 1): BinderFile {
  const loc = locate(binder, id)
  if (!loc) return binder
  const b = clone(binder)
  const list = siblings(b, loc.area, loc.parentId)
  const j = loc.index + dir
  if (j < 0 || j >= list.length) return binder
  ;[list[loc.index], list[j]] = [list[j], list[loc.index]]
  return b
}

export function updateItem(binder: BinderFile, id: string, patch: Partial<BinderItem>): BinderFile {
  const b = clone(binder)
  const it = findItem(b, id)
  if (!it) return binder
  Object.assign(it, patch, { modified: new Date().toISOString() })
  return b
}

/** Add a new item after `afterId` (as sibling), inside `parentId`, or at the end of the manuscript. */
export function addItem(
  binder: BinderFile,
  item: BinderItem,
  opts: { afterId?: string | null; insideId?: string | null; area?: Area } = {}
): BinderFile {
  const b = clone(binder)
  if (opts.insideId) {
    const p = findItem(b, opts.insideId)
    if (p) {
      p.children.push(item)
      p.collapsed = false
      return b
    }
  }
  if (opts.afterId) {
    const loc = locate(b, opts.afterId)
    if (loc) {
      insert(b, item, { ...loc, index: loc.index + 1 })
      return b
    }
  }
  b[opts.area ?? 'manuscript'].push(item)
  return b
}

export function trashItem(binder: BinderFile, id: string): BinderFile {
  const loc = locate(binder, id)
  if (!loc || loc.area === 'trash') return binder
  const b = clone(binder)
  const item = detach(b, id)
  b.trash.unshift(item)
  return b
}

/** Flattened manuscript order (depth-first) — the reading order of the book. */
export function manuscriptOrder(binder: BinderFile): BinderItem[] {
  return [...walk(binder.manuscript)]
}

/** Sum of words for an item and all its descendants. */
export function totalWords(item: BinderItem, counts: Record<string, { words: number }>): number {
  let n = counts[item.id]?.words ?? 0
  for (const c of item.children) n += totalWords(c, counts)
  return n
}

export function manuscriptWords(binder: BinderFile, counts: Record<string, { words: number }>): number {
  return binder.manuscript.reduce((s, it) => s + totalWords(it, counts), 0)
}
