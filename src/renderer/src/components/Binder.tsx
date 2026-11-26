import { useEffect, useRef, useState } from 'react'
import type { BinderFile, BinderItem, ItemKind } from '../../../shared/types'
import { ITEM_KINDS } from '../../../shared/types'
import {
  addItem,
  findItem,
  indent,
  locate,
  makeItem,
  moveItem,
  moveToArea,
  moveUpDown,
  outdent,
  totalWords,
  trashItem,
  updateItem,
  walk,
  type Area,
  type DropPosition
} from '../../../shared/binder'
import { Icon } from './Icon'

interface Props {
  binder: BinderFile
  counts: Record<string, { words: number }>
  selected: string | null
  onSelect: (id: string) => void
  onChange: (b: BinderFile, newSelection?: string) => void
  onEmptyTrash: () => void
  onQuickRef: (id: string) => void
}

const RANK: Record<ItemKind, number> = { part: 0, chapter: 1, folder: 1, section: 2, scene: 3, note: 3 }
const AREA_LABEL: Record<Area, string> = { manuscript: 'Manuscript', research: 'Notes & research', trash: 'Trash' }

function defaultTitle(kind: ItemKind, binder: BinderFile): string {
  const label = ITEM_KINDS.find((k) => k.kind === kind)!.label
  if (kind === 'note' || kind === 'folder') return `New ${label.toLowerCase()}`
  let n = 0
  for (const it of walk(binder.manuscript)) if (it.kind === kind) n++
  return `${label} ${n + 1}`
}

/**
 * Add a new item where a writer would expect it, based on what's selected:
 *  - same kind selected (or inside one) → right after it
 *  - a "bigger" item selected (e.g. a chapter when adding a scene) → at the end inside it
 */
export function smartAdd(binder: BinderFile, kind: ItemKind, selected: string | null): { binder: BinderFile; id: string } {
  const item = makeItem(kind, defaultTitle(kind, binder))
  let cur = selected ? locate(binder, selected) : undefined
  let curId = selected
  if (cur?.area === 'trash') cur = undefined
  if (!cur) {
    const area: Area = kind === 'note' ? 'research' : 'manuscript'
    // A scene with nothing selected goes into the last chapter.
    if (RANK[kind] > 1 && area === 'manuscript') {
      const chapters = binder.manuscript.filter((i) => RANK[i.kind] < RANK[kind])
      const last = chapters[chapters.length - 1]
      if (last) return { binder: addItem(binder, item, { insideId: last.id }), id: item.id }
    }
    return { binder: addItem(binder, item, { area }), id: item.id }
  }
  while (curId) {
    const it = findItem(binder, curId)!
    if (RANK[it.kind] === RANK[kind]) return { binder: addItem(binder, item, { afterId: it.id }), id: item.id }
    if (RANK[it.kind] < RANK[kind]) return { binder: addItem(binder, item, { insideId: it.id }), id: item.id }
    const loc = locate(binder, curId)!
    if (loc.parentId === null) return { binder: addItem(binder, item, { afterId: it.id }), id: item.id }
    curId = loc.parentId
  }
  return { binder: addItem(binder, item), id: item.id }
}

interface Menu {
  x: number
  y: number
  id: string | null
  area: Area
}

export function Binder({ binder, counts, selected, onSelect, onChange, onEmptyTrash, onQuickRef }: Props): React.JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [drop, setDrop] = useState<{ id: string; pos: DropPosition } | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const dragId = useRef<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const add = (kind: ItemKind, from: string | null = selected): void => {
    const r = smartAdd(binder, kind, from)
    onChange(r.binder, r.id)
    setRenaming(r.id)
  }

  const onKey = (e: React.KeyboardEvent, it: BinderItem): void => {
    if (renaming) return
    const flat = visibleOrder()
    const i = flat.indexOf(it.id)
    if (e.key === 'ArrowDown' && i < flat.length - 1) {
      e.preventDefault()
      onSelect(flat[i + 1])
    } else if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault()
      onSelect(flat[i - 1])
    } else if (e.key === 'F2' || (e.key === 'Enter' && !e.ctrlKey)) {
      e.preventDefault()
      setRenaming(it.id)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      onChange(e.shiftKey ? outdent(binder, it.id) : indent(binder, it.id))
    } else if (e.key === 'Delete') {
      e.preventDefault()
      onChange(trashItem(binder, it.id))
    } else if (e.key === 'ArrowRight' && it.children.length && it.collapsed) {
      onChange(updateItem(binder, it.id, { collapsed: false }))
    } else if (e.key === 'ArrowLeft' && it.children.length && !it.collapsed) {
      onChange(updateItem(binder, it.id, { collapsed: true }))
    }
  }

  const visibleOrder = (): string[] => {
    const out: string[] = []
    const rec = (items: BinderItem[]): void => {
      for (const it of items) {
        out.push(it.id)
        if (!it.collapsed) rec(it.children)
      }
    }
    rec(binder.manuscript)
    rec(binder.research)
    if (trashOpen) rec(binder.trash)
    return out
  }

  const onDragOver = (e: React.DragEvent, it: BinderItem): void => {
    if (!dragId.current || dragId.current === it.id) return
    e.preventDefault()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    const pos: DropPosition = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
    if (drop?.id !== it.id || drop.pos !== pos) setDrop({ id: it.id, pos })
  }

  const onDrop = (e: React.DragEvent, it: BinderItem): void => {
    e.preventDefault()
    const id = dragId.current
    dragId.current = null
    setDrop(null)
    if (id && drop) onChange(moveItem(binder, id, it.id, drop.pos))
  }

  const row = (it: BinderItem, depth: number, area: Area): React.JSX.Element => {
    const total = totalWords(it, counts)
    const cls = ['binder-row', selected === it.id ? 'selected' : '', drop?.id === it.id ? `drop-${drop.pos}` : ''].join(' ')
    return (
      <li key={it.id} role="treeitem" aria-expanded={it.children.length ? !it.collapsed : undefined} aria-selected={selected === it.id}>
        <div
          className={cls}
          style={{ paddingLeft: 6 + depth * 16 }}
          tabIndex={selected === it.id ? 0 : -1}
          draggable={renaming !== it.id}
          data-id={it.id}
          data-testid={`binder-${it.title}`}
          onClick={() => onSelect(it.id)}
          onDoubleClick={() => setRenaming(it.id)}
          onKeyDown={(e) => onKey(e, it)}
          onContextMenu={(e) => {
            e.preventDefault()
            onSelect(it.id)
            setMenu({ x: e.clientX, y: e.clientY, id: it.id, area })
          }}
          onDragStart={(e) => {
            dragId.current = it.id
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', it.title)
          }}
          onDragEnd={() => {
            dragId.current = null
            setDrop(null)
          }}
          onDragOver={(e) => onDragOver(e, it)}
          onDragLeave={() => drop?.id === it.id && setDrop(null)}
          onDrop={(e) => onDrop(e, it)}
          ref={(el) => {
            if (el && selected === it.id && document.activeElement?.closest('.binder') && document.activeElement !== el && !renaming) el.focus()
          }}
        >
          <button
            className={`chev ${it.children.length ? '' : 'hidden'} ${it.collapsed ? '' : 'open'}`}
            tabIndex={-1}
            aria-label={it.collapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation()
              onChange(updateItem(binder, it.id, { collapsed: !it.collapsed }))
            }}
          >
            <Icon name="chevron" size={12} />
          </button>
          <span className={`kind kind-${it.kind}`} title={ITEM_KINDS.find((k) => k.kind === it.kind)?.label}>
            <Icon name={it.kind} size={15} />
          </span>
          {renaming === it.id ? (
            <input
              className="rename"
              autoFocus
              defaultValue={it.title}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const t = e.target.value.trim()
                setRenaming(null)
                if (t && t !== it.title) onChange(updateItem(binder, it.id, { title: t }))
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  ;(e.target as HTMLInputElement).value = it.title
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
          ) : (
            <span className="title">{it.title}</span>
          )}
          {total > 0 && <span className="count">{total.toLocaleString()}</span>}
        </div>
        {it.children.length > 0 && !it.collapsed && <ul role="group">{it.children.map((c) => row(c, depth + 1, area))}</ul>}
      </li>
    )
  }

  const areaHeader = (area: Area, extra?: React.ReactNode): React.JSX.Element => (
    <div
      className="area-header"
      onDragOver={(e) => {
        if (dragId.current) e.preventDefault()
      }}
      onDrop={(e) => {
        e.preventDefault()
        const id = dragId.current
        dragId.current = null
        setDrop(null)
        if (id) onChange(moveToArea(binder, id, area))
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, id: null, area })
      }}
    >
      {AREA_LABEL[area]}
      {extra}
    </div>
  )

  const menuItems = (): React.ReactNode => {
    if (!menu) return null
    const it = menu.id ? findItem(binder, menu.id) : undefined
    const item = (label: string, fn: () => void, testid?: string, disabled = false): React.JSX.Element => (
      <button
        key={label}
        className="menu-item"
        disabled={disabled}
        data-testid={testid}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          setMenu(null)
          fn()
        }}
      >
        {label}
      </button>
    )
    if (menu.area === 'trash') {
      return (
        <>
          {it && item('Put back into the manuscript', () => onChange(moveToArea(binder, it.id, 'manuscript')))}
          {it && item('Put back into notes & research', () => onChange(moveToArea(binder, it.id, 'research')))}
          {binder.trash.length > 0 && item('Empty trash…', onEmptyTrash)}
        </>
      )
    }
    if (!it) {
      return (
        <>
          {item('New chapter', () => add('chapter', null))}
          {item('New scene', () => add('scene', null))}
          {item('New note', () => add('note', null))}
        </>
      )
    }
    const loc = locate(binder, it.id)!
    return (
      <>
        {item('Rename', () => setRenaming(it.id))}
        {item('Open as quick reference', () => onQuickRef(it.id))}
        <div className="menu-sep" />
        {item('New scene here', () => add('scene', it.id))}
        {item('New section here', () => add('section', it.id))}
        {item('New chapter here', () => add('chapter', it.id))}
        {item('New item inside', () => {
          const n = makeItem(it.kind === 'chapter' || it.kind === 'part' ? 'scene' : it.kind, 'Untitled')
          onChange(addItem(binder, n, { insideId: it.id }), n.id)
          setRenaming(n.id)
        })}
        <div className="menu-sep" />
        <div className="menu-label">Turn into</div>
        <div className="menu-kinds">
          {ITEM_KINDS.map((k) => (
            <button
              key={k.kind}
              className={`kind-chip ${it.kind === k.kind ? 'on' : ''}`}
              data-testid={`kind-${k.kind}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                setMenu(null)
                onChange(updateItem(binder, it.id, { kind: k.kind }))
              }}
            >
              <Icon name={k.kind} size={13} /> {k.label}
            </button>
          ))}
        </div>
        <div className="menu-sep" />
        {item('Move up', () => onChange(moveUpDown(binder, it.id, -1)), undefined, loc.index === 0)}
        {item('Move down', () => onChange(moveUpDown(binder, it.id, 1)))}
        {item('Indent (put inside the item above)   Tab', () => onChange(indent(binder, it.id)), 'indent', loc.index === 0)}
        {item('Outdent (move out of its parent)   Shift+Tab', () => onChange(outdent(binder, it.id)), 'outdent', loc.parentId === null)}
        <div className="menu-sep" />
        {item('Move to trash   Del', () => onChange(trashItem(binder, it.id)), 'trash-item')}
      </>
    )
  }

  return (
    <nav className="binder" aria-label="Binder">
      <div className="binder-actions">
        <button className="btn small" onClick={() => add('chapter')} title="New chapter" data-testid="add-chapter">
          <Icon name="plus" size={13} /> Chapter
        </button>
        <button className="btn small" onClick={() => add('scene')} title="New scene (Ctrl+N)" data-testid="add-scene">
          <Icon name="plus" size={13} /> Scene
        </button>
        <button className="btn small" onClick={() => add('section')} title="New section" data-testid="add-section">
          <Icon name="plus" size={13} /> Section
        </button>
      </div>
      <div className="binder-tree">
        {areaHeader('manuscript')}
        <ul role="tree">{binder.manuscript.map((it) => row(it, 0, 'manuscript'))}</ul>
        {areaHeader(
          'research',
          <button className="icon-btn subtle inline" title="New note" onClick={() => add('note', null)}>
            <Icon name="plus" size={13} />
          </button>
        )}
        <ul role="tree">{binder.research.map((it) => row(it, 0, 'research'))}</ul>
        <div className="trash-block">
          {areaHeader(
            'trash',
            <button className="icon-btn subtle inline" onClick={() => setTrashOpen(!trashOpen)} title={trashOpen ? 'Hide trash' : 'Show trash'}>
              <span className="muted small">{binder.trash.length ? `${binder.trash.length} · ` : ''}{trashOpen ? 'hide' : 'show'}</span>
            </button>
          )}
          {trashOpen && <ul role="tree">{binder.trash.map((it) => row(it, 0, 'trash'))}</ul>}
        </div>
      </div>
      {menu && (
        <div className="menu" style={{ left: menu.x, top: Math.min(menu.y, window.innerHeight - 420) }} onMouseDown={(e) => e.stopPropagation()}>
          {menuItems()}
        </div>
      )}
    </nav>
  )
}
