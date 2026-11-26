import { useCallback, useEffect, useRef, useState } from 'react'
import type { OpenedProject } from '../../shared/types'
import { api } from './api'
import { Welcome } from './components/Welcome'
import { ProjectView } from './components/ProjectView'
import { Icon } from './components/Icon'
import { flushAll } from './flush'

export function App(): React.JSX.Element {
  const [projects, setProjects] = useState<OpenedProject[]>([])
  /** null = the Home tab */
  const [active, setActive] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const projectsRef = useRef(projects)
  projectsRef.current = projects

  useEffect(() => {
    api().onFlushRequest(flushAll)
  }, [])

  const addProject = useCallback((p: OpenedProject | null) => {
    if (!p) return
    setProjects((list) => (list.some((x) => x.path === p.path) ? list : [...list, p]))
    setActive(p.path)
  }, [])

  const run = useCallback(async (fn: () => Promise<OpenedProject | null>) => {
    setError(null)
    try {
      addProject(await fn())
    } catch (e) {
      setError(cleanError(e))
    }
  }, [addProject])

  const closeTab = async (p: string): Promise<void> => {
    await flushAll()
    await api().closeProject(p)
    const list = projectsRef.current.filter((x) => x.path !== p)
    setProjects(list)
    if (active === p) setActive(list.length ? list[list.length - 1].path : null)
  }

  const titleOf = (p: string, title: string): void =>
    setProjects((list) => list.map((x) => (x.path === p ? { ...x, manifest: { ...x.manifest, title } } : x)))

  return (
    <div className="app">
      <div className="tabbar" role="tablist">
        <button
          className={`tab home ${active === null ? 'active' : ''}`}
          onClick={() => setActive(null)}
          title="Home: open or create projects"
          role="tab"
          aria-selected={active === null}
        >
          <Icon name="home" />
        </button>
        {projects.map((p) => (
          <div
            key={p.path}
            className={`tab ${active === p.path ? 'active' : ''}`}
            role="tab"
            aria-selected={active === p.path}
            onClick={() => setActive(p.path)}
            onAuxClick={(e) => e.button === 1 && closeTab(p.path)}
            title={p.path}
          >
            <span className="tab-title">{p.manifest.title}</span>
            <button
              className="tab-close"
              title="Close project"
              aria-label={`Close ${p.manifest.title}`}
              onClick={(e) => {
                e.stopPropagation()
                void closeTab(p.path)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="tab add" title="Open or create another project" onClick={() => setActive(null)}>
          +
        </button>
      </div>
      <div className="tab-body">
        {active === null && (
          <Welcome
            openPaths={projects.map((p) => p.path)}
            error={error}
            onCreate={(dir, title, author) => run(() => api().createProject(dir, title, author))}
            onOpenDialog={() => run(() => api().openProjectDialog())}
            onOpen={(p) => run(() => api().openProject(p))}
          />
        )}
        {projects.map((p) => (
          <div key={p.path} className="project-host" style={{ display: active === p.path ? 'flex' : 'none' }}>
            <ProjectView project={p} visible={active === p.path} onTitle={(t) => titleOf(p.path, t)} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
