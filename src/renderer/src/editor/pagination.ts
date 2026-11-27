import { Extension, textInputRule } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

/**
 * Real pages.
 *
 * The text is one continuous column, as tall as the page's text area. After each change we measure
 * where every line falls. When a line would go past the bottom of a page, a spacer is inserted
 * right before it. The spacer covers the bottom margin, the gap between sheets and the next page's
 * top margin, so the line starts at the top of the next page. Paragraphs are split across pages
 * line by line, the way a printed book does it. The page sheets are drawn behind the text by the
 * React component, using the page count reported here.
 */

export interface PageGeometry {
  /** Height of the text area of one page, in CSS px. */
  contentHeight: number
  /** Distance from the bottom of one page's text area to the top of the next page's text area. */
  between: number
}

export interface PaginationOptions {
  getGeometry: () => PageGeometry
  onPages: (count: number) => void
}

export const paginationKey = new PluginKey<DecorationSet>('foliant-pagination')

interface Break {
  pos: number
  height: number
  /** true when the break falls between two blocks (not inside a paragraph) */
  block: boolean
}

function spacer(height: number, block: boolean): HTMLElement {
  const el = document.createElement(block ? 'div' : 'span')
  el.className = 'page-spacer'
  el.contentEditable = 'false'
  el.style.display = 'block'
  el.style.height = `${height}px`
  el.setAttribute('aria-hidden', 'true')
  return el
}

/** Measure line boxes (in unzoomed CSS px, relative to the editor's top) for every block. */
function measure(view: EditorView, geo: PageGeometry): { breaks: Break[]; pages: number } {
  const root = view.dom as HTMLElement
  const rootRect = root.getBoundingClientRect()
  const scale = root.offsetHeight ? rootRect.height / root.offsetHeight || 1 : 1
  const toLocal = (y: number): number => (y - rootRect.top) / scale

  interface Line {
    top: number
    bottom: number
    x: number // viewport x of the line's first character
    yMid: number // viewport y of the line's middle
    first: boolean
    blockEl: HTMLElement
  }
  const lines: Line[] = []

  const blocks = root.querySelectorAll<HTMLElement>(':scope > *:not(.page-spacer), :scope > blockquote > *, :scope > ul > li > *, :scope > ol > li > *')
  for (const el of blocks) {
    if (el.tagName === 'BLOCKQUOTE' || el.tagName === 'UL' || el.tagName === 'OL') continue
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
    if (rects.length === 0 || el.tagName === 'HR') {
      const r = el.getBoundingClientRect()
      lines.push({ top: toLocal(r.top), bottom: toLocal(r.bottom), x: r.left + 1, yMid: r.top + r.height / 2, first: true, blockEl: el })
      continue
    }
    // Group fragments into lines by their vertical middle.
    const groups: { mid: number; left: number }[] = []
    for (const r of rects) {
      const mid = r.top + r.height / 2
      const g = groups.find((x) => Math.abs(x.mid - mid) < (lh * scale) / 2.5)
      if (g) g.left = Math.min(g.left, r.left)
      else groups.push({ mid, left: r.left })
    }
    groups.sort((a, b) => a.mid - b.mid)
    groups.forEach((g, i) => {
      const mid = toLocal(g.mid)
      lines.push({ top: mid - lh / 2, bottom: mid + lh / 2, x: g.left + 1, yMid: g.mid, first: i === 0, blockEl: el })
    })
  }

  const breaks: Break[] = []
  const period = geo.contentHeight + geo.between
  let page = 0
  for (const line of lines) {
    const pageEnd = page * period + geo.contentHeight
    // Lines are measured without spacers, so their positions only need shifting by spacers so far.
    const shift = breaks.reduce((s, b) => s + b.height, 0)
    const top = line.top + shift
    const bottom = line.bottom + shift
    if (bottom <= pageEnd + 0.5) continue
    // A line taller than a whole page can't be helped; let it overflow.
    while (bottom > (page + 1) * period + geo.contentHeight && top >= (page + 1) * period) page++
    if (top < page * period) continue
    const nextTop = (page + 1) * period
    const height = nextTop - top
    let pos: number
    let block = false
    if (line.first) {
      // Break before the whole block.
      pos = view.posAtDOM(line.blockEl, 0)
      const $p = view.state.doc.resolve(pos)
      pos = $p.depth > 0 ? $p.before($p.depth) : pos
      block = true
    } else {
      const hit = view.posAtCoords({ left: line.x, top: line.yMid })
      if (!hit) continue
      pos = hit.pos
    }
    breaks.push({ pos, height, block })
    page++
  }
  return { breaks, pages: page + 1 }
}

export const Pagination = Extension.create<PaginationOptions>({
  name: 'foliantPagination',

  addOptions() {
    return { getGeometry: () => ({ contentHeight: 1000, between: 200 }), onPages: () => undefined }
  },

  addProseMirrorPlugins() {
    const opts = this.options
    let frame = 0
    let timer = 0
    let lastSig = ''

    const recompute = (view: EditorView): void => {
      if (frame) cancelAnimationFrame(frame)
      if (timer) clearTimeout(timer)
      frame = 0
      timer = 0
      if (view.isDestroyed || (view as unknown as { composing: boolean }).composing) return
      const geo = opts.getGeometry()
      if (geo.contentHeight < 50) return
      // 1) lay out without spacers, 2) measure, 3) put spacers back — all before the next paint.
      view.dispatch(view.state.tr.setMeta(paginationKey, DecorationSet.empty).setMeta('addToHistory', false))
      const { breaks, pages } = measure(view, geo)
      const decos = breaks.map((b) =>
        Decoration.widget(b.pos, () => spacer(b.height, b.block), {
          side: -1,
          ignoreSelection: true,
          key: `pb-${b.pos}-${Math.round(b.height)}`
        })
      )
      view.dispatch(view.state.tr.setMeta(paginationKey, DecorationSet.create(view.state.doc, decos)).setMeta('addToHistory', false))
      opts.onPages(pages)
    }

    const schedule = (view: EditorView): void => {
      if (frame || timer) return
      // Normally runs right before the next paint; the timer covers windows that don't paint (hidden).
      frame = requestAnimationFrame(() => recompute(view))
      timer = window.setTimeout(() => recompute(view), 32)
    }

    return [
      new Plugin<DecorationSet>({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(paginationKey) as DecorationSet | undefined
            if (meta) return meta
            return set.map(tr.mapping, tr.doc)
          }
        },
        props: {
          decorations(state) {
            return paginationKey.getState(state)
          }
        },
        view(view) {
          schedule(view)
          // Fonts load asynchronously and change line heights; re-measure once they're ready.
          void document.fonts?.ready.then(() => !view.isDestroyed && schedule(view))
          let width = 0
          const ro = new ResizeObserver(() => {
            const w = (view.dom as HTMLElement).offsetWidth
            if (w !== width) {
              width = w
              schedule(view)
            }
          })
          ro.observe(view.dom)
          return {
            update(v, prev) {
              const geo = opts.getGeometry()
              const sig = `${geo.contentHeight}|${geo.between}`
              if (!v.state.doc.eq(prev.doc) || sig !== lastSig) {
                lastSig = sig
                schedule(v)
              }
            },
            destroy() {
              // The same plugin can get a new view later (editor reconfigured), so reset fully.
              if (frame) cancelAnimationFrame(frame)
              if (timer) clearTimeout(timer)
              frame = 0
              timer = 0
              ro.disconnect()
            }
          }
        }
      })
    ]
  }
})

/** Typing two hyphens makes an em dash. */
export const EmDash = Extension.create({
  name: 'foliantEmDash',
  addInputRules() {
    return [textInputRule({ find: /--$/, replace: '—' })]
  }
})
