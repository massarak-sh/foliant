/**
 * Foliant project format — shared types.
 *
 * A project is a folder ending in `.foliant`:
 *
 *   My Novel.foliant/
 *     foliant.json            manifest: format version, title, writing defaults, languages
 *     binder.json             the binder tree (manuscript + trash), titles, kinds, order
 *     docs/<id>.json          text of each binder item (ProseMirror JSON)
 *     docs/<id>@<lang>.json   (phase 5) translation of the same item, side by side
 *     notes/<id>.json         (phase 3) notes attached to an item; notes/project.json for the project
 *     comments/<id>.json      (phase 3) comment threads; anchors live as marks inside the doc
 *     snapshots/<id>/<stamp>.json   snapshots of an item
 *     stats/days.json         per-day words added / removed / project total (history over time)
 *     .journal/journal.log    write-ahead log of edits, replayed after a crash
 *     .backups/<id>/...       rolling copies of previous versions of each file
 *     .lock                   which computer has the project open
 *
 * Everything is plain JSON so it can be read, diffed, backed up and recovered without Foliant.
 */

export const FORMAT_VERSION = 1

/** ProseMirror / TipTap JSON document. Kept loose on purpose. */
export interface RichDoc {
  type: 'doc'
  content?: RichNode[]
}
export interface RichNode {
  type: string
  attrs?: Record<string, unknown>
  content?: RichNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

/** What a binder item is called. Purely a label: any kind can hold text and children. */
export type ItemKind = 'part' | 'chapter' | 'section' | 'scene' | 'folder' | 'note'

export const ITEM_KINDS: { kind: ItemKind; label: string }[] = [
  { kind: 'part', label: 'Part' },
  { kind: 'chapter', label: 'Chapter' },
  { kind: 'section', label: 'Section' },
  { kind: 'scene', label: 'Scene' },
  { kind: 'folder', label: 'Folder' },
  { kind: 'note', label: 'Note' }
]

export interface BinderItem {
  id: string
  kind: ItemKind
  title: string
  children: BinderItem[]
  /** Collapsed in the binder UI. */
  collapsed?: boolean
  /** Short summary (index card text). */
  synopsis?: string
  /** Included when exporting the manuscript (phase 4). Defaults to true. */
  includeInExport?: boolean
  /** Free label/status, e.g. "Draft", "Revised" (later phases). */
  status?: string
  created: string
  modified: string
}

export interface BinderFile {
  formatVersion: number
  manuscript: BinderItem[]
  /** Research / notes area outside the manuscript. Never exported. */
  research: BinderItem[]
  trash: BinderItem[]
}

export interface PageSetup {
  /** Paper size for page view and export. */
  paper: 'A4' | 'Letter' | 'A5' | 'B5' | 'Custom'
  widthMm: number
  heightMm: number
  marginTopMm: number
  marginBottomMm: number
  marginLeftMm: number
  marginRightMm: number
}

export interface TextStyle {
  fontFamily: string
  fontSizePt: number
  lineSpacing: number
  /** First-line paragraph indent in em. */
  firstLineIndentEm: number
  /** Space after paragraphs in pt. */
  paragraphSpacingPt: number
}

export interface ProjectSettings {
  /** How the text looks while writing and (by default) in export. */
  text: TextStyle
  page: PageSetup
  /** Daily word goal, 0 = none. */
  dailyGoal: number
}

export interface LanguageInfo {
  code: string
  name: string
}

export interface Manifest {
  formatVersion: number
  app: 'Foliant'
  id: string
  title: string
  author?: string
  created: string
  modified: string
  settings: ProjectSettings
  /** Primary language of the manuscript; translations are added in phase 5. */
  languages: LanguageInfo[]
}

export interface DocFile {
  formatVersion: number
  id: string
  /** 'primary' or a language code (phase 5). */
  lang: string
  content: RichDoc
  words: number
  chars: number
  modified: string
}

export interface SnapshotMeta {
  id: string
  docId: string
  name: string
  created: string
  words: number
  /** 'manual' | 'auto-before-restore' | 'auto-daily' */
  reason: string
}

export interface SnapshotFile extends SnapshotMeta {
  formatVersion: number
  content: RichDoc
}

export interface DayStats {
  added: number
  removed: number
  /** Project manuscript total at the last save of the day. */
  total: number
}

export interface StatsFile {
  formatVersion: number
  days: Record<string, DayStats>
}

/** What the renderer receives when a project opens. */
export interface OpenedProject {
  path: string
  manifest: Manifest
  binder: BinderFile
  /** Word counts per doc id, so totals are known without opening each doc. */
  counts: Record<string, { words: number; chars: number }>
  stats: StatsFile
  /** Documents whose unsaved edits were recovered from the journal on open. */
  recovered: string[]
}

export interface SaveResult {
  ok: boolean
  /** ISO time of the verified write. */
  savedAt?: string
  error?: string
  words: number
  chars: number
  /** Words added/removed by this save compared to the previous version. */
  added: number
  removed: number
  today: DayStats
}

export interface RecentProject {
  path: string
  title: string
  openedAt: string
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  text: {
    fontFamily: 'EB Garamond',
    fontSizePt: 12,
    lineSpacing: 1.1,
    firstLineIndentEm: 1.5,
    paragraphSpacingPt: 0
  },
  page: {
    paper: 'A4',
    widthMm: 210,
    heightMm: 297,
    marginTopMm: 25,
    marginBottomMm: 25,
    marginLeftMm: 25,
    marginRightMm: 25
  },
  dailyGoal: 0
}

/** Standard Manuscript Format, used by export (phase 4) as a preset. */
export const MANUSCRIPT_FORMAT: TextStyle = {
  fontFamily: 'Times New Roman',
  fontSizePt: 12,
  lineSpacing: 2,
  firstLineIndentEm: 2.5,
  paragraphSpacingPt: 0
}
