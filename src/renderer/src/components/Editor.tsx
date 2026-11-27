import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor as TipTap } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import type { PageSetup, RichDoc, SaveResult, TextStyle } from '../../../shared/types'
import { EmDash, Pagination } from '../editor/pagination'
import { countChars, countWords } from '../../../shared/text'
import { api } from '../api'
import { registerFlusher } from '../flush'
import { cleanError } from '../App'

export type SaveStatus =
  | { state: 'saved'; at: string }
  | { state: 'dirty' }
  | { state: 'saving' }
  | { state: 'error'; message: string }

export interface EditorHandle {
  flush: () => Promise<void>
  editor: TipTap | null
  /** Replace the text (e.g. after restoring a snapshot) without creating an extra save. */
  replace: (content: RichDoc) => void
}

interface Props {
  projectPath: string
  docId: string
  initial: RichDoc
  style: TextStyle
  page: PageSetup
  zoom: number
  handleRef: React.Ref<EditorHandle>
  onEditor: (e: TipTap | null) => void
  onSaved: (r: SaveResult, docId: string) => void
  onStatus: (s: SaveStatus) => void
  onLiveCounts: (words: number, chars: number) => void
}

const IDLE_MS = 600 // save after this pause in typing
const MAX_WAIT_MS = 3000 // …but never keep edits unsaved longer than this while typing
const RETRY_MS = 3000
const PAGE_GAP = 28 // space between sheets, px

export function Editor(props: Props): React.JSX.Element {
  const { projectPath, docId, initial, style, page, zoom } = props
  const mm = (v: number): number => (v * 96) / 25.4
  const pageW = mm(page.widthMm)
  const pageH = mm(page.heightMm)
  const top = mm(page.marginTopMm)
  const bottom = mm(page.marginBottomMm)
  const left = mm(page.marginLeftMm)
  const textW = pageW - left - mm(page.marginRightMm)
  const geometry = useRef({ contentHeight: pageH - top - bottom, between: bottom + PAGE_GAP + top })
  geometry.current = { contentHeight: pageH - top - bottom, between: bottom + PAGE_GAP + top }
  const [pages, setPages] = useState(1)
  // "Fit width" (zoom 0): scale the page to the space available.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setAvail(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const effZoom = zoom > 0 ? zoom : avail ? Math.max(0.6, Math.min(1.6, (avail - 48) / pageW)) : 1
  const cb = useRef(props)
  cb.current = props

  const dirty = useRef(false)
  const firstDirtyAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<void> | null>(null)
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = useRef<TipTap | null>(null)

  const doSave = async (): Promise<void> => {
    const ed = editorRef.current
    if (!ed || !dirty.current) return
    if (inflight.current) {
      await inflight.current
      return doSave()
    }
    dirty.current = false
    firstDirtyAt.current = 0
    const content = ed.getJSON() as RichDoc
    const t = Date.now()
    cb.current.onStatus({ state: 'saving' })
    const p = (async () => {
      let result: SaveResult
      try {
        result = await api().saveDoc(projectPath, docId, content, t)
      } catch (e) {
        result = { ok: false, error: cleanError(e), words: 0, chars: 0, added: 0, removed: 0, today: { added: 0, removed: 0, total: 0 } }
      }
      if (result.ok) {
        cb.current.onSaved(result, docId)
        if (!dirty.current) {
          cb.current.onStatus({ state: 'saved', at: result.savedAt! })
        }
      } else {
        // Keep the edit marked unsaved and try again; the text is still in the editor and in the stash.
        dirty.current = true
        cb.current.onStatus({ state: 'error', message: result.error ?? 'Unknown error' })
        schedule(RETRY_MS)
      }
    })()
    inflight.current = p
    try {
      await p
    } finally {
      inflight.current = null
    }
  }

  const schedule = (ms: number): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void doSave()
    }, ms)
  }

  const flush = async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (inflight.current) await inflight.current
    if (dirty.current) await doSave()
  }

  // Stream the text being typed to the main process (coalesced), as crash insurance between saves.
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stage = (): void => {
    if (stageTimer.current) return
    stageTimer.current = setTimeout(() => {
      stageTimer.current = null
      const ed = editorRef.current
      if (ed && dirty.current) api().stageDoc(projectPath, docId, ed.getJSON() as RichDoc, Date.now())
    }, 40)
  }

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          codeBlock: false,
          code: false,
          link: { openOnClick: false, autolink: false }
        }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Highlight,
        EmDash,
        Pagination.configure({ getGeometry: () => geometry.current, onPages: (n) => setPages(n) })
      ],
      content: initial,
      autofocus: false,
      editorProps: {
        attributes: { class: 'prose', spellcheck: 'true', 'data-testid': 'editor' }
      },
      onUpdate: ({ editor: ed }) => {
        if (!dirty.current) firstDirtyAt.current = Date.now()
        dirty.current = true
        stage()
        cb.current.onStatus({ state: 'dirty' })
        const waited = Date.now() - firstDirtyAt.current
        schedule(waited >= MAX_WAIT_MS ? 0 : Math.min(IDLE_MS, MAX_WAIT_MS - waited))
        if (countTimer.current) clearTimeout(countTimer.current)
        countTimer.current = setTimeout(() => {
          const t = ed.getText({ blockSeparator: '\n' })
          cb.current.onLiveCounts(countWords(t), countChars(t))
        }, 150)
      }
    },
    [docId]
  )
  editorRef.current = editor

  useEffect(() => {
    cb.current.onEditor(editor)
    return () => cb.current.onEditor(null)
  }, [editor])

  useImperativeHandle(
    props.handleRef,
    () => ({
      flush,
      editor,
      replace: (content: RichDoc) => {
        editor?.commands.setContent(content, { emitUpdate: false })
        const t = editor?.getText({ blockSeparator: '\n' }) ?? ''
        cb.current.onLiveCounts(countWords(t), countChars(t))
      }
    }),
    [editor]
  )

  // Register for app-wide flush (quit, tab close) and save whatever is left when this scene closes.
  useEffect(() => {
    const unregister = registerFlusher(flush)
    return () => {
      unregister()
      void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, editor])

  // Try to save when the window loses focus or is hidden.
  useEffect(() => {
    const onHide = (): void => void flush()
    window.addEventListener('blur', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('blur', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, editor])

  const cssVars = {
    '--text-font': `"${style.fontFamily}", "EB Garamond", Georgia, serif`,
    '--text-size': `${style.fontSizePt}pt`,
    '--text-leading': String(style.lineSpacing * 1.2),
    '--text-indent': `${style.firstLineIndentEm}em`,
    '--text-para-space': `${style.paragraphSpacingPt}pt`
  } as React.CSSProperties

  const stackH = pages * (pageH + PAGE_GAP) - PAGE_GAP
  return (
    <div
      className="editor-scroll"
      ref={scrollRef}
      onMouseDown={(e) => {
        // Clicking around or below the text puts the cursor in it.
        const t = e.target as HTMLElement
        if (t === e.currentTarget || t.classList.contains('page') || t.classList.contains('page-stack')) {
          e.preventDefault()
          editor?.commands.focus('end')
        }
      }}
    >
      <div className="pages-zoom" style={{ zoom: effZoom }}>
        <div className="page-stack" style={{ ...cssVars, width: pageW, height: stackH }} data-testid="page-stack" data-pages={pages}>
          {Array.from({ length: pages }, (_, i) => (
            <div key={i} className="page" style={{ top: i * (pageH + PAGE_GAP), height: pageH, width: pageW }}>
              <span className="page-num" style={{ bottom: bottom / 2 - 8 }}>
                {i + 1}
              </span>
            </div>
          ))}
          <div className="page-text" style={{ top, left, width: textW }}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  )
}
