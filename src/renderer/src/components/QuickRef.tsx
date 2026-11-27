import { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import type { BinderFile, RichDoc, TextStyle } from '../../../shared/types'
import { allItems, findItem } from '../../../shared/binder'
import { api } from '../api'

interface Props {
  projectPath: string
  binder: BinderFile
  id: string | null
  currentId: string | null
  style: TextStyle
  onPick: (id: string) => void
}

/** Read-only view of another scene, to look at while writing. */
export function QuickRef({ projectPath, binder, id, currentId, style, onPick }: Props): React.JSX.Element {
  const [content, setContent] = useState<RichDoc | null>(null)
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false }), TextAlign.configure({ types: ['heading', 'paragraph'] }), Highlight],
    editable: false,
    content: null
  })

  useEffect(() => {
    if (!id) return
    void api()
      .loadDoc(projectPath, id)
      .then((d) => setContent(d.content))
  }, [projectPath, id])

  useEffect(() => {
    if (editor && content) editor.commands.setContent(content, { emitUpdate: false })
  }, [editor, content])

  const items = allItems({ ...binder, trash: [] })
  return (
    <div className="panel quickref">
      <select className="block" value={id ?? ''} onChange={(e) => onPick(e.target.value)}>
        <option value="" disabled>
          Choose a scene or note to look at…
        </option>
        {items.map((it) => (
          <option key={it.id} value={it.id} disabled={it.id === currentId}>
            {it.title}
          </option>
        ))}
      </select>
      {id && findItem(binder, id) ? (
        <div className="ref-text" style={{ fontFamily: `"${style.fontFamily}", serif`, fontSize: `${style.fontSizePt}pt`, lineHeight: style.lineSpacing * 1.2 }}>
          <EditorContent editor={editor} />
        </div>
      ) : (
        <p className="hint">Pick any scene to keep it open here while you write the current one. You can also right-click an item in the binder and choose “Open as quick reference”.</p>
      )}
    </div>
  )
}
