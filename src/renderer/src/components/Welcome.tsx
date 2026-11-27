import { useEffect, useState } from 'react'
import type { RecentProject } from '../../../shared/types'
import { api } from '../api'
import { Icon } from './Icon'

interface Props {
  openPaths: string[]
  error: string | null
  onCreate: (dir: string, title: string, author?: string) => Promise<void>
  onOpenDialog: () => Promise<void>
  onOpen: (path: string) => Promise<void>
}

export function Welcome({ openPaths, error, onCreate, onOpenDialog, onOpen }: Props): React.JSX.Element {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api().recent().then(setRecent)
    void api().info().then((i) => setDir((d) => d || i.defaultDir))
  }, [openPaths.length])

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    await onCreate(dir, title.trim(), author.trim() || undefined)
    setBusy(false)
    setCreating(false)
    setTitle('')
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1 className="brand">Foliant</h1>
        <p className="tagline">A quiet place for your stories.</p>

        {error && <div className="banner error">{error}</div>}

        {!creating ? (
          <div className="welcome-actions">
            <button className="btn primary big" onClick={() => setCreating(true)} data-testid="new-project">
              <Icon name="plus" /> New project
            </button>
            <button className="btn big" onClick={() => void onOpenDialog()}>
              <Icon name="folderOpen" /> Open project…
            </button>
          </div>
        ) : (
          <form className="new-project" onSubmit={create}>
            <label>
              Title
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Long Winter" data-testid="new-title" />
            </label>
            <label>
              Author <span className="muted">(optional)</span>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} />
            </label>
            <label>
              Keep it in
              <div className="row">
                <input value={dir} onChange={(e) => setDir(e.target.value)} className="grow" data-testid="new-dir" />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const d = await api().chooseFolder(dir)
                    if (d) setDir(d)
                  }}
                >
                  Change…
                </button>
              </div>
            </label>
            <div className="row end">
              <button type="button" className="btn" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!title.trim() || busy} data-testid="create-project">
                Create
              </button>
            </div>
          </form>
        )}

        {recent.length > 0 && (
          <div className="recent">
            <h2>Recent projects</h2>
            <ul>
              {recent.map((r) => (
                <li key={r.path}>
                  <button className="recent-item" onClick={() => void onOpen(r.path)} title={r.path}>
                    <span className="recent-title">{r.title}</span>
                    <span className="recent-path">{r.path}</span>
                    {openPaths.includes(r.path) && <span className="pill">open</span>}
                  </button>
                  <button
                    className="icon-btn subtle"
                    title="Remove from this list (the project itself is not deleted)"
                    onClick={async () => {
                      await api().forgetRecent(r.path)
                      setRecent(await api().recent())
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
