import type { ItemKind } from '../../../shared/types'

const paths: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  part: 'M5 3h11l3 3v15H5zM8 8h8M8 12h8M8 16h5',
  chapter: 'M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-3a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h4z',
  section: 'M4 5h16M4 10h16M4 15h10M4 20h6',
  scene: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  note: 'M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  alignJustify: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  quote: 'M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6',
  sceneBreak: 'M6 12h.01M12 12h.01M18 12h.01',
  clear: 'M5 5l14 14M9 4h10M14 4l-4 16',
  highlight: 'M9 11l6-6 4 4-6 6zM9 11l-4 4v4h4l4-4M4 21h16',
  restore: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  compare: 'M8 3v18M16 3v18M3 8h5M16 16h5',
  close: 'M6 6l12 12M18 6 6 18',
  folderOpen: 'M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v2H7l-3 8H4a1 1 0 0 1-1-1zM7 11h15l-3 8H4z',
  check: 'M5 12l5 5 9-10',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  more: 'M5 12h.01M12 12h.01M19 12h.01'
}

export function Icon({ name, size = 16 }: { name: string; size?: number }): React.JSX.Element {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'sceneBreak' || name === 'more' ? 3.2 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.scene} />
    </svg>
  )
}

export const kindIcon = (k: ItemKind): string => k
