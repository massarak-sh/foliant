import { useEffect, useMemo, useState } from 'react'
import { diffWordsWithSpace } from 'diff'
import type { RichDoc, SnapshotFile, SnapshotMeta } from '../../../shared/types'
import { docToText } from '../../../shared/text'
import { api } from '../api'
import { Icon } from './Icon'

interface Props {
  projectPath: string
  docId: string
  docTitle: string
  /** bump to reload the list (e.g. after taking a snapshot from the toolbar) */
  version: number
  getCurrent: () => RichDoc | null
  onTake: () => void
  onRestore: (snapId: string) => Promise<void>
}

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const yest = new Date(today.getTime() - 86400000).toDateString() === d.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `Today, ${time}`
  if (yest) return `Yesterday, ${time}`
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })}, ${time}`
}

export function SnapshotsPanel({ projectPath, docId, docTitle, version, getCurrent, onTake, onRestore }: Props): React.JSX.Element {
  const [list, setList] = useState<SnapshotMeta[]>([])
  const [comparing, setComparing] = useState<SnapshotFile | null>(null)
  const [confirm, setConfirm] = useState<SnapshotMeta | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const reload = async (): Promise<void> => setList(await api().listSnapshots(projectPath, docId))
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, docId, version])

  return (
    <div className="panel snapshots">
      <div className="panel-head">
        <span>Snapshots of “{docTitle}”</span>
      </div>
      <button className="btn primary block" onClick={onTake} data-testid="panel-take-snapshot">
        <Icon name="camera" /> Take snapshot now
      </button>
      <p className="hint">A snapshot is a saved copy of this text you can compare with or go back to at any time. Restoring never loses anything: the current text is snapshotted first.</p>
      {list.length === 0 && <p className="muted center">No snapshots yet.</p>}
      <ul className="snap-list" data-testid="snap-list">
        {list.map((s) => (
          <li key={s.id} className={`snap ${s.reason !== 'manual' ? 'auto' : ''}`}>
            {editing === s.id ? (
              <input
                className="rename"
                autoFocus
                defaultValue={s.name}
                onBlur={async (e) => {
                  setEditing(null)
                  if (e.target.value.trim() && e.target.value !== s.name) {
                    await api().renameSnapshot(projectPath, docId, s.id, e.target.value)
                    void reload()
                  }
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <div className="snap-name" onDoubleClick={() => setEditing(s.id)} title="Double-click to rename">
                {s.name}
              </div>
            )}
            <div className="snap-meta">
              {formatWhen(s.created)} · {s.words.toLocaleString()} words
            </div>
            <div className="snap-actions">
              <button
                className="btn small"
                data-testid="snap-compare"
                onClick={async () => setComparing(await api().getSnapshot(projectPath, docId, s.id))}
              >
                <Icon name="compare" size={13} /> Compare
              </button>
              <button className="btn small" data-testid="snap-restore" onClick={() => setConfirm(s)}>
                <Icon name="restore" size={13} /> Restore
              </button>
              <button className="icon-btn subtle" title="Rename" onClick={() => setEditing(s.id)}>
                <Icon name="edit" size={13} />
              </button>
              <button
                className="icon-btn subtle"
                title="Delete snapshot"
                onClick={async () => {
                  if (window.confirm(`Delete the snapshot “${s.name}”? This can't be undone.`)) {
                    await api().deleteSnapshot(projectPath, docId, s.id)
                    void reload()
                  }
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {confirm && (
        <div className="modal-backdrop" onMouseDown={() => setConfirm(null)}>
          <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Restore “{confirm.name}”?</h3>
            <p>The text of this scene will be replaced by the snapshot from {formatWhen(confirm.created)}. Your current text will be saved as a snapshot first, so you can always come back to it.</p>
            <div className="row end">
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                data-testid="confirm-restore"
                onClick={async () => {
                  const s = confirm
                  setConfirm(null)
                  await onRestore(s.id)
                  void reload()
                }}
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {comparing && (
        <CompareModal
          snap={comparing}
          current={getCurrent()}
          onClose={() => setComparing(null)}
          onRestore={() => {
            const meta = list.find((x) => x.id === comparing.id) ?? null
            setComparing(null)
            setConfirm(meta)
          }}
        />
      )}
    </div>
  )
}

function CompareModal({ snap, current, onClose, onRestore }: { snap: SnapshotFile; current: RichDoc | null; onClose: () => void; onRestore: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<'changes' | 'side'>('changes')
  const oldText = useMemo(() => docToText(snap.content), [snap])
  const newText = useMemo(() => docToText(current), [current])
  const parts = useMemo(() => diffWordsWithSpace(oldText, newText), [oldText, newText])
  const stats = useMemo(() => {
    let a = 0
    let r = 0
    for (const p of parts) {
      const n = (p.value.match(/[\p{L}\p{N}]+/gu) ?? []).length
      if (p.added) a += n
      else if (p.removed) r += n
    }
    return { a, r }
  }, [parts])

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal compare" onMouseDown={(e) => e.stopPropagation()} data-testid="compare-modal">
        <div className="compare-head">
          <div>
            <h3>Compare with “{snap.name}”</h3>
            <div className="muted small">
              Snapshot from {formatWhen(snap.created)} → current text ·{' '}
              <span className="ins-chip">+{stats.a} words</span> <span className="del-chip">−{stats.r} words</span>
            </div>
          </div>
          <div className="row">
            <div className="segmented">
              <button className={mode === 'changes' ? 'on' : ''} onClick={() => setMode('changes')}>
                Changes
              </button>
              <button className={mode === 'side' ? 'on' : ''} onClick={() => setMode('side')}>
                Side by side
              </button>
            </div>
            <button className="btn" onClick={onRestore}>
              <Icon name="restore" size={13} /> Restore this snapshot
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
        </div>
        {mode === 'changes' ? (
          <div className="compare-body diff">
            {parts.map((p, i) => (
              <span key={i} className={p.added ? 'ins' : p.removed ? 'del' : ''}>
                {p.value}
              </span>
            ))}
          </div>
        ) : (
          <div className="compare-side">
            <div className="compare-body">
              <div className="side-label">Snapshot</div>
              {oldText}
            </div>
            <div className="compare-body">
              <div className="side-label">Now</div>
              {newText}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
