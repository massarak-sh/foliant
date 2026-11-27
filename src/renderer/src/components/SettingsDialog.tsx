import { useState } from 'react'
import type { Manifest, PageSetup } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/types'
import { api } from '../api'

const FONTS = ['EB Garamond', 'Times New Roman', 'Georgia', 'Cambria', 'Palatino Linotype', 'Book Antiqua', 'Garamond', 'Calibri', 'Arial', 'Courier New']

const PAPERS: Record<Exclude<PageSetup['paper'], 'Custom'>, [number, number]> = {
  A4: [210, 297],
  Letter: [215.9, 279.4],
  A5: [148, 210],
  B5: [176, 250]
}

interface Props {
  manifest: Manifest
  path: string
  onClose: () => void
  onSave: (m: Manifest) => Promise<void>
}

export function SettingsDialog({ manifest, path, onClose, onSave }: Props): React.JSX.Element {
  const [m, setM] = useState<Manifest>(structuredClone(manifest))
  const t = m.settings.text
  const p = m.settings.page
  const setText = (patch: Partial<typeof t>): void => setM({ ...m, settings: { ...m.settings, text: { ...t, ...patch } } })
  const setPage = (patch: Partial<PageSetup>): void => setM({ ...m, settings: { ...m.settings, page: { ...p, ...patch } } })
  const num = (v: string, min: number, max: number, fallback: number): number => {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal settings"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault()
          await onSave(m)
          onClose()
        }}
      >
        <h3>Project settings</h3>

        <section>
          <h4>Project</h4>
          <label>
            Title
            <input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} />
          </label>
          <label>
            Author
            <input value={m.author ?? ''} onChange={(e) => setM({ ...m, author: e.target.value })} />
          </label>
        </section>

        <section>
          <h4>How the text looks</h4>
          <p className="hint">Used while you write and, by default, when you export.</p>
          <div className="grid2">
            <label>
              Font
              <input list="font-list" value={t.fontFamily} onChange={(e) => setText({ fontFamily: e.target.value })} data-testid="font-input" />
              <datalist id="font-list">
                {FONTS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <label>
              Size (pt)
              <input type="number" step="0.5" min="6" max="48" value={t.fontSizePt} onChange={(e) => setText({ fontSizePt: num(e.target.value, 6, 48, 12) })} />
            </label>
            <label>
              Line spacing
              <input type="number" step="0.05" min="0.8" max="3" value={t.lineSpacing} onChange={(e) => setText({ lineSpacing: num(e.target.value, 0.8, 3, 1.1) })} />
            </label>
            <label>
              First-line indent (em)
              <input type="number" step="0.25" min="0" max="5" value={t.firstLineIndentEm} onChange={(e) => setText({ firstLineIndentEm: num(e.target.value, 0, 5, 1.5) })} />
            </label>
            <label>
              Space after paragraph (pt)
              <input type="number" step="1" min="0" max="36" value={t.paragraphSpacingPt} onChange={(e) => setText({ paragraphSpacingPt: num(e.target.value, 0, 36, 0) })} />
            </label>
          </div>
          <div className="preview" style={{ fontFamily: `"${t.fontFamily}", serif`, fontSize: `${t.fontSizePt}pt`, lineHeight: t.lineSpacing * 1.2 }}>
            <p style={{ textIndent: 0, marginBottom: `${t.paragraphSpacingPt}pt` }}>The rain had stopped by the time she reached the bridge, but the river still ran high and loud.</p>
            <p style={{ textIndent: `${t.firstLineIndentEm}em` }}>She did not look back. There was nothing behind her worth the turning.</p>
          </div>
          <button type="button" className="btn small" onClick={() => setM({ ...m, settings: { ...m.settings, text: { ...DEFAULT_SETTINGS.text } } })}>
            Reset to EB Garamond 12 · 1.1
          </button>
        </section>

        <section>
          <h4>Page</h4>
          <div className="grid2">
            <label>
              Paper
              <select
                value={p.paper}
                onChange={(e) => {
                  const paper = e.target.value as PageSetup['paper']
                  if (paper === 'Custom') setPage({ paper })
                  else setPage({ paper, widthMm: PAPERS[paper][0], heightMm: PAPERS[paper][1] })
                }}
              >
                {Object.keys(PAPERS).map((k) => (
                  <option key={k}>{k}</option>
                ))}
                <option>Custom</option>
              </select>
            </label>
            <label>
              Margins (mm)
              <input
                type="number"
                min="5"
                max="60"
                value={p.marginLeftMm}
                onChange={(e) => {
                  const v = num(e.target.value, 5, 60, 25)
                  setPage({ marginLeftMm: v, marginRightMm: v, marginTopMm: v, marginBottomMm: v })
                }}
              />
            </label>
            {p.paper === 'Custom' && (
              <>
                <label>
                  Width (mm)
                  <input type="number" value={p.widthMm} onChange={(e) => setPage({ widthMm: num(e.target.value, 80, 400, 210) })} />
                </label>
                <label>
                  Height (mm)
                  <input type="number" value={p.heightMm} onChange={(e) => setPage({ heightMm: num(e.target.value, 100, 500, 297) })} />
                </label>
              </>
            )}
          </div>
          <p className="hint">The writing column has the same width as the text on a printed page, so lines break where they will on paper.</p>
        </section>

        <section>
          <h4>Daily goal</h4>
          <label className="inline">
            <input
              type="number"
              min="0"
              step="50"
              value={m.settings.dailyGoal}
              onChange={(e) => setM({ ...m, settings: { ...m.settings, dailyGoal: num(e.target.value, 0, 100000, 0) } })}
            />{' '}
            words a day <span className="muted">(0 = no goal)</span>
          </label>
        </section>

        <div className="row between">
          <button type="button" className="btn subtle" onClick={() => void api().showInFolder(path)}>
            Show project folder
          </button>
          <div className="row">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" data-testid="save-settings">
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
