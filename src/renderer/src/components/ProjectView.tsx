import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor as TipTap } from '@tiptap/react'
import type { BinderFile, DayStats, Manifest, OpenedProject, RichDoc, SaveResult } from '../../../shared/types'
import { findItem, manuscriptOrder, manuscriptWords } from '../../../shared/binder'
import { dayKey } from '../../../shared/text'
import { api } from '../api'
import { cleanError } from '../App'
import { Binder, smartAdd } from './Binder'
import { Editor, type EditorHandle, type SaveStatus } from './Editor'
import { Toolbar } from './Toolbar'
import { SnapshotsPanel, formatWhen } from './Snapshots'
import { SettingsDialog } from './SettingsDialog'
import { QuickRef } from './QuickRef'
import { Icon } from './Icon'

interface Props {
  project: OpenedProject
  visible: boolean
  onTitle: (t: string) => void
}

type Side = 'snapshots' | 'reference' | null

const pref = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
const setPref = (key: string, v: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

export function ProjectView({ project, visible, onTitle }: Props): React.JSX.Element {
  const path = project.path
  const [binder, setBinder] = useState<BinderFile>(project.binder)
  const [manifest, setManifest] = useState<Manifest>(project.manifest)
  const [counts, setCounts] = useState(project.counts)
  const [today, setToday] = useState<DayStats>(project.stats.days[dayKey()] ?? { added: 0, removed: 0, total: 0 })
  const [session, setSession] = useState({ added: 0, removed: 0 })
  const [selected, setSelected] = useState<string | null>(() => {
    const last = pref<string | null>(`foliant:last:${path}`, null)
    if (last && findItem(project.binder, last)) return last
    return manuscriptOrder(project.binder).find((i) => i.kind === 'scene')?.id ?? project.binder.manuscript[0]?.id ?? null
  })
  const [doc, setDoc] = useState<{ id: string; content: RichDoc } | null>(null)
  const [status, setStatus] = useState<SaveStatus>({ state: 'saved', at: '' })
  const [live, setLive] = useState<{ words: number; chars: number } | null>(null)
  const [side, setSide] = useState<Side>(() => pref<Side>('foliant:side', 'snapshots'))
  const [refId, setRefId] = useState<string | null>(null)
  const [snapVersion, setSnapVersion] = useState(0)
  const [recovered, setRecovered] = useState<string[]>(project.recovered)
  const [toast, setToast] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [zoom, setZoom] = useState<number>(() => pref('foliant:zoom', 1.25))
  const [editor, setEditor] = useState<TipTap | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const handle = useRef<EditorHandle>(null)
  const loadSeq = useRef(0)

  const showToast = (t: string): void => {
    setToast(t)
    setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 2600)
  }

  // Load the selected document.
  useEffect(() => {
    if (!selected) {
      setDoc(null)
      return
    }
    setPref(`foliant:last:${path}`, selected)
    const seq = ++loadSeq.current
    setLoadError(null)
    api()
      .loadDoc(path, selected)
      .then((d) => {
        if (seq !== loadSeq.current) return
        setDoc({ id: d.id, content: d.content })
        setLive({ words: d.words, chars: d.chars })
        setStatus({ state: 'saved', at: d.modified })
      })
      .catch((e) => seq === loadSeq.current && setLoadError(cleanError(e)))
  }, [path, selected])

  const select = useCallback(async (id: string) => {
    if (id === selected) return
    await handle.current?.flush()
    setSelected(id)
  }, [selected])

  const changeBinder = useCallback(
    (b: BinderFile, newSelection?: string) => {
      setBinder(b)
      void api()
        .saveBinder(path, b)
        .catch((e) => setStatus({ state: 'error', message: `Binder not saved: ${cleanError(e)}` }))
      if (newSelection) void select(newSelection)
    },
    [path, select]
  )

  const onSaved = useCallback((r: SaveResult, docId: string) => {
    setToday(r.today)
    setSession((s) => ({ added: s.added + r.added, removed: s.removed + r.removed }))
    setCounts((c) => ({ ...c, [docId]: { words: r.words, chars: r.chars } }))
  }, [])

  const takeSnapshot = async (): Promise<void> => {
    if (!selected) return
    await handle.current?.flush()
    const now = new Date()
    const name = `Snapshot ${now.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    try {
      await api().createSnapshot(path, selected, name)
      setSnapVersion((v) => v + 1)
      setSide('snapshots')
      showToast('Snapshot taken')
    } catch (e) {
      showToast(`Snapshot failed: ${cleanError(e)}`)
    }
  }

  const restore = async (snapId: string): Promise<void> => {
    if (!selected) return
    await handle.current?.flush()
    try {
      const { doc: d, result } = await api().restoreSnapshot(path, selected, snapId)
      handle.current?.replace(d.content)
      onSaved(result, selected)
      setStatus({ state: 'saved', at: result.savedAt! })
      setSnapVersion((v) => v + 1)
      showToast('Snapshot restored')
    } catch (e) {
      showToast(`Restore failed: ${cleanError(e)}`)
    }
  }

  // Keyboard shortcuts (only for the visible project).
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '5') {
        e.preventDefault()
        void takeSnapshot()
      } else if (e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault()
        void handle.current?.flush().then(() => showToast('Everything is saved'))
      } else if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault()
        const r = smartAdd(binder, 'scene', selected)
        changeBinder(r.binder, r.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const saveSettings = async (m: Manifest): Promise<void> => {
    setManifest(m)
    onTitle(m.title)
    await api().saveManifest(path, m)
  }

  const emptyTrash = async (): Promise<void> => {
    const n = binder.trash.length
    if (!window.confirm(`Permanently delete ${n} item${n === 1 ? '' : 's'} in the trash? (A last copy is kept in the project's backup folder.)`)) return
    const b = await api().emptyTrash(path)
    setBinder(b)
  }

  const item = selected ? findItem(binder, selected) : undefined
  const page = manifest.settings.page
  const textWidthPx = ((page.widthMm - page.marginLeftMm - page.marginRightMm) * 96) / 25.4
  const total = manuscriptWords(binder, counts)
  const goal = manifest.settings.dailyGoal
  const net = today.added - today.removed
  const sideToggle = (s: Side): void => {
    const v = side === s ? null : s
    setSide(v)
    setPref('foliant:side', v)
  }

  return (
    <div className="project">
      <Binder
        binder={binder}
        counts={counts}
        selected={selected}
        onSelect={(id) => void select(id)}
        onChange={changeBinder}
        onEmptyTrash={() => void emptyTrash()}
        onQuickRef={(id) => {
          setRefId(id)
          setSide('reference')
        }}
      />
      <main className="center-pane">
        {recovered.length > 0 && (
          <div className="banner info" data-testid="recovered-banner">
            <Icon name="check" /> Foliant recovered unsaved changes after an unexpected shutdown in:{' '}
            {recovered.map((id) => findItem(binder, id)?.title ?? 'an item').join(', ')}. Nothing was lost.
            <button className="icon-btn subtle" onClick={() => setRecovered([])} aria-label="Dismiss">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        <Toolbar editor={editor} zoom={zoom} onZoom={(z) => { setZoom(z); setPref('foliant:zoom', z) }} onSnapshot={() => void takeSnapshot()} />
        <div className="doc-title-row">
          <span className="doc-title" data-testid="doc-title">{item?.title ?? ''}</span>
          <span className="grow" />
          <button className={`tool wide ${side === 'snapshots' ? 'on' : ''}`} onClick={() => sideToggle('snapshots')} title="Show snapshots">
            <Icon name="camera" /> Snapshots
          </button>
          <button className={`tool wide ${side === 'reference' ? 'on' : ''}`} onClick={() => sideToggle('reference')} title="Show a scene for reference while you write">
            <Icon name="scene" /> Reference
          </button>
          <button className="tool" onClick={() => setSettingsOpen(true)} title="Project settings: text style, page, goal" data-testid="open-settings">
            <Icon name="settings" />
          </button>
        </div>
        {loadError && <div className="banner error">Couldn't open this item: {loadError}</div>}
        {doc && item && doc.id === selected ? (
          <Editor
            key={doc.id}
            projectPath={path}
            docId={doc.id}
            initial={doc.content}
            style={manifest.settings.text}
            textWidthPx={textWidthPx}
            zoom={zoom}
            handleRef={handle}
            onEditor={setEditor}
            onSaved={onSaved}
            onStatus={setStatus}
            onLiveCounts={(words, chars) => setLive({ words, chars })}
          />
        ) : (
          <div className="empty-center muted">{selected ? 'Opening…' : 'Select or create a scene in the binder.'}</div>
        )}
        <footer className="statusbar">
          <span data-testid="doc-count">
            {live ? `${live.words.toLocaleString()} words · ${live.chars.toLocaleString()} characters` : ''}
          </span>
          <span className="sb-sep" />
          <span title="Words in the whole manuscript (not counting notes and trash)">Manuscript: {total.toLocaleString()} words</span>
          <span className="sb-sep" />
          <span className="today" title="Words written and cut today, in all scenes" data-testid="today-count">
            Today: <span className="plus">+{today.added.toLocaleString()}</span> <span className="minus">−{today.removed.toLocaleString()}</span>{' '}
            <b>({net >= 0 ? '+' : '−'}{Math.abs(net).toLocaleString()} net)</b>
          </span>
          <span className="sb-sep" />
          <span title="Since you opened this project" data-testid="session-count">
            This session: <span className="plus">+{session.added.toLocaleString()}</span> <span className="minus">−{session.removed.toLocaleString()}</span>
          </span>
          {goal > 0 && (
            <>
              <span className="sb-sep" />
              <span className="goal" title={`Daily goal: ${goal} words`}>
                <span className="goal-bar">
                  <span style={{ width: `${Math.min(100, (Math.max(0, net) / goal) * 100)}%` }} />
                </span>
                {Math.max(0, net).toLocaleString()} / {goal.toLocaleString()}
              </span>
            </>
          )}
          <span className="grow" />
          <SaveIndicator status={status} />
        </footer>
      </main>
      {side && (
        <aside className="side">
          {side === 'snapshots' && selected && item && (
            <SnapshotsPanel
              projectPath={path}
              docId={selected}
              docTitle={item.title}
              version={snapVersion}
              getCurrent={() => (handle.current?.editor?.getJSON() as RichDoc) ?? null}
              onTake={() => void takeSnapshot()}
              onRestore={restore}
            />
          )}
          {side === 'reference' && (
            <QuickRef projectPath={path} binder={binder} id={refId} onPick={setRefId} style={manifest.settings.text} currentId={selected} />
          )}
        </aside>
      )}
      {settingsOpen && <SettingsDialog manifest={manifest} path={path} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function SaveIndicator({ status }: { status: SaveStatus }): React.JSX.Element {
  switch (status.state) {
    case 'saved':
      return (
        <span className="save ok" data-testid="save-status" title={status.at ? `Written to disk and checked at ${new Date(status.at).toLocaleTimeString()}` : 'Saved'}>
          <Icon name="check" size={14} /> Saved{status.at ? ` · ${formatWhen(status.at)}` : ''}
        </span>
      )
    case 'dirty':
      return <span className="save pending" data-testid="save-status">Editing…</span>
    case 'saving':
      return <span className="save pending" data-testid="save-status">Saving…</span>
    case 'error':
      return (
        <span className="save err" data-testid="save-status" title={status.message}>
          <Icon name="warn" size={14} /> Not saved yet — retrying ({status.message})
        </span>
      )
  }
}
