import type { FoliantApi } from '../../preload/index'

declare global {
  interface Window {
    foliant: FoliantApi
  }
}

export const api = (): FoliantApi => window.foliant
