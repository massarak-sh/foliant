import { useEffect, useReducer } from 'react'
import type { Editor } from '@tiptap/react'
import { Icon } from './Icon'

interface Props {
  editor: Editor | null
  zoom: number
  onZoom: (z: number) => void
  onSnapshot: () => void
}

const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export function Toolbar({ editor, zoom, onZoom, onSnapshot }: Props): React.JSX.Element {
  // Re-render when the selection or marks change so buttons show the active state.
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!editor) return
    editor.on('transaction', force)
    return () => {
      editor.off('transaction', force)
    }
  }, [editor])

  const btn = (label: string, title: string, active: boolean, run: () => void, content: React.ReactNode, disabled = false): React.JSX.Element => (
    <button
      className={`tool ${active ? 'on' : ''}`}
      title={title}
      aria-label={label}
      aria-pressed={active}
      disabled={!editor || disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {content}
    </button>
  )
  const c = (): ReturnType<Editor['chain']> => editor!.chain().focus()
  const is = (n: string, a?: Record<string, unknown>): boolean => !!editor?.isActive(n, a)
  const align = (a: string): boolean => !!editor?.isActive({ textAlign: a })

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {btn('Undo', 'Undo (Ctrl+Z)', false, () => c().undo().run(), <Icon name="undo" />, !editor?.can().undo())}
      {btn('Redo', 'Redo (Ctrl+Y)', false, () => c().redo().run(), <Icon name="redo" />, !editor?.can().redo())}
      <span className="sep" />
      <select
        className="tool-select"
        title="Paragraph style"
        disabled={!editor}
        value={is('heading', { level: 1 }) ? 'h1' : is('heading', { level: 2 }) ? 'h2' : is('heading', { level: 3 }) ? 'h3' : is('blockquote') ? 'quote' : 'p'}
        onChange={(e) => {
          const v = e.target.value
          const ch = c()
          if (v === 'p') ch.setParagraph().run()
          else if (v === 'quote') ch.setParagraph().setBlockquote().run()
          else ch.setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run()
        }}
      >
        <option value="p">Body text</option>
        <option value="h1">Title</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
        <option value="quote">Block quote</option>
      </select>
      <span className="sep" />
      {btn('Bold', 'Bold (Ctrl+B)', is('bold'), () => c().toggleBold().run(), <b>B</b>)}
      {btn('Italic', 'Italic (Ctrl+I)', is('italic'), () => c().toggleItalic().run(), <i className="serif">I</i>)}
      {btn('Underline', 'Underline (Ctrl+U)', is('underline'), () => c().toggleUnderline().run(), <u>U</u>)}
      {btn('Strikethrough', 'Strikethrough (Ctrl+Shift+S)', is('strike'), () => c().toggleStrike().run(), <s>S</s>)}
      {btn('Highlight', 'Highlight (Ctrl+Shift+H)', is('highlight'), () => c().toggleHighlight().run(), <Icon name="highlight" />)}
      <span className="sep" />
      {btn('Align left', 'Align left', align('left'), () => c().setTextAlign('left').run(), <Icon name="alignLeft" />)}
      {btn('Center', 'Center', align('center'), () => c().setTextAlign('center').run(), <Icon name="alignCenter" />)}
      {btn('Align right', 'Align right', align('right'), () => c().setTextAlign('right').run(), <Icon name="alignRight" />)}
      {btn('Justify', 'Justify', align('justify'), () => c().setTextAlign('justify').run(), <Icon name="alignJustify" />)}
      <span className="sep" />
      {btn('Scene break', 'Insert scene break (* * *)', false, () => c().setHorizontalRule().run(), <Icon name="sceneBreak" />)}
      {btn('Clear formatting', 'Clear formatting', false, () => c().unsetAllMarks().setParagraph().unsetTextAlign().run(), <Icon name="clear" />)}
      <span className="grow" />
      <button className="tool wide" title="Take a snapshot of this text (Ctrl+5)" onClick={onSnapshot} disabled={!editor} data-testid="take-snapshot">
        <Icon name="camera" /> Snapshot
      </button>
      <span className="sep" />
      <select className="tool-select" title="Zoom" value={zoom} onChange={(e) => onZoom(Number(e.target.value))}>
        {ZOOMS.map((z) => (
          <option key={z} value={z}>
            {Math.round(z * 100)}%
          </option>
        ))}
      </select>
    </div>
  )
}
