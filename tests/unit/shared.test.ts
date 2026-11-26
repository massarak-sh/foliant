import { describe, expect, it } from 'vitest'
import { countChars, countWords, docToText, wordDelta } from '../../src/shared/text'
import { addItem, indent, makeItem, moveItem, outdent, trashItem, findItem, locate } from '../../src/shared/binder'
import type { BinderFile } from '../../src/shared/types'

describe('counting', () => {
  it('counts words in English and Russian, with apostrophes and hyphens', () => {
    expect(countWords("She didn't look back — not once.")).toBe(6)
    expect(countWords('Мороз и солнце; день чудесный!')).toBe(5)
    expect(countWords('well-known fact')).toBe(2)
    expect(countWords('')).toBe(0)
  })
  it('counts characters with and without spaces', () => {
    expect(countChars('ab cd')).toBe(5)
    expect(countChars('ab cd', false)).toBe(4)
  })
  it('extracts text from rich docs', () => {
    const t = docToText({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two', marks: [{ type: 'bold' }] }] }
      ]
    })
    expect(t).toBe('One\nTwo')
  })
  it('measures words added and removed', () => {
    expect(wordDelta('a b c', 'a b c d e')).toEqual({ added: 2, removed: 0 })
    expect(wordDelta('a b c d', 'a d')).toEqual({ added: 0, removed: 2 })
    expect(wordDelta('the cat sat', 'the dog sat')).toEqual({ added: 1, removed: 1 })
    expect(wordDelta('same', 'same')).toEqual({ added: 0, removed: 0 })
  })
})

describe('binder operations', () => {
  const setup = (): { b: BinderFile; ch1: string; sc1: string; sc2: string; ch2: string } => {
    const ch1 = makeItem('chapter', 'Ch1')
    const sc1 = makeItem('scene', 'S1')
    const sc2 = makeItem('scene', 'S2')
    ch1.children.push(sc1, sc2)
    const ch2 = makeItem('chapter', 'Ch2')
    return { b: { formatVersion: 1, manuscript: [ch1, ch2], research: [], trash: [] }, ch1: ch1.id, sc1: sc1.id, sc2: sc2.id, ch2: ch2.id }
  }

  it('moves an item inside another, before and after', () => {
    const { b, sc1, ch2, ch1 } = setup()
    const b1 = moveItem(b, sc1, ch2, 'inside')
    expect(findItem(b1, ch2)!.children.map((c) => c.id)).toEqual([sc1])
    const b2 = moveItem(b1, sc1, ch1, 'before')
    expect(b2.manuscript.map((c) => c.id)).toEqual([sc1, ch1, ch2])
  })
  it('refuses to move a parent into its own child', () => {
    const { b, ch1, sc1 } = setup()
    expect(moveItem(b, ch1, sc1, 'inside')).toBe(b)
  })
  it('indents and outdents', () => {
    const { b, sc2, sc1, ch1 } = setup()
    const b1 = indent(b, sc2)
    expect(findItem(b1, sc1)!.children[0].id).toBe(sc2)
    const b2 = outdent(outdent(b1, sc2), sc2)
    expect(locate(b2, sc2)).toMatchObject({ parentId: null, index: 1 })
    expect(b2.manuscript[0].id).toBe(ch1)
  })
  it('adds after an item and trashes with children', () => {
    const { b, ch1 } = setup()
    const n = makeItem('chapter', 'New')
    const b1 = addItem(b, n, { afterId: ch1 })
    expect(b1.manuscript[1].id).toBe(n.id)
    const b2 = trashItem(b1, ch1)
    expect(b2.trash[0].children.length).toBe(2)
    expect(b2.manuscript.length).toBe(2)
  })
})
