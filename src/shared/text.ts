import { diffArrays } from 'diff'
import type { RichDoc, RichNode } from './types'

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'listItem', 'horizontalRule', 'sceneBreak'])

/** Plain text of a rich document; blocks separated by newlines. */
export function docToText(doc: RichDoc | undefined | null): string {
  if (!doc) return ''
  const out: string[] = []
  const walk = (node: RichNode): void => {
    if (node.type === 'text') {
      out.push(node.text ?? '')
      return
    }
    if (node.type === 'hardBreak') {
      out.push('\n')
      return
    }
    node.content?.forEach(walk)
    if (BLOCK_TYPES.has(node.type)) out.push('\n')
  }
  doc.content?.forEach(walk)
  return out.join('').replace(/\n+$/, '')
}

// Letters/digits (any script, incl. Cyrillic), joined by apostrophes or hyphens inside a word.
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-‐][\p{L}\p{N}]+)*/gu

export function words(text: string): string[] {
  return text.match(WORD_RE) ?? []
}

export function countWords(text: string): number {
  return words(text).length
}

export function countChars(text: string, withSpaces = true): number {
  const t = text.replace(/\n/g, '')
  return withSpaces ? [...t].length : [...t.replace(/\s/g, '')].length
}

/**
 * How many words were added and removed going from `before` to `after`.
 * Replacing one word counts as one removed + one added.
 */
export function wordDelta(before: string, after: string): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 }
  const a = words(before)
  const b = words(after)
  if (a.length === 0) return { added: b.length, removed: 0 }
  if (b.length === 0) return { added: 0, removed: a.length }
  // Trim the common prefix/suffix first: typing usually touches a small region.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  if (midA.length === 0) return { added: midB.length, removed: 0 }
  if (midB.length === 0) return { added: 0, removed: midA.length }
  // Very large rewrites: skip the exact diff and approximate (keeps saves fast).
  if (midA.length * midB.length > 4e7) {
    return { added: midB.length, removed: midA.length }
  }
  let added = 0
  let removed = 0
  for (const part of diffArrays(midA, midB)) {
    if (part.added) added += part.count ?? part.value.length
    else if (part.removed) removed += part.count ?? part.value.length
  }
  return { added, removed }
}

export function emptyDoc(): RichDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
