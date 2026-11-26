/**
 * Everything that may hold unsaved text registers a flush function here, so that closing a tab,
 * switching scenes or quitting the app can wait until every edit has been handed to the disk.
 */
const flushers = new Set<() => Promise<void>>()

export function registerFlusher(fn: () => Promise<void>): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}

export async function flushAll(): Promise<void> {
  await Promise.allSettled([...flushers].map((f) => f()))
}
