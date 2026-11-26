import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Retry an fs operation that Windows sometimes refuses briefly (antivirus, indexer, sync tools). */
async function retry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES' && code !== 'EAGAIN') throw err
      lastErr = err
      await sleep(25 * 2 ** i)
    }
  }
  throw lastErr
}

async function fsyncDir(dir: string): Promise<void> {
  // Makes the rename durable on Linux/macOS. Windows can't open directories; NTFS journals renames itself.
  if (process.platform === 'win32') return
  try {
    const h = await fs.open(dir, 'r')
    try {
      await h.sync()
    } finally {
      await h.close()
    }
  } catch {
    /* best effort */
  }
}

export class VerifyError extends Error {}

/**
 * Crash-safe, verified write:
 *  1. write to a temporary file next to the target and flush it to disk (fsync)
 *  2. read the temporary file back and compare checksums
 *  3. atomically rename it over the target (the old file stays intact until this instant)
 *  4. read the target back and compare checksums again
 * If anything fails the original file is untouched and an error is thrown.
 */
export async function writeFileVerified(file: string, data: string): Promise<void> {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const expected = sha256(data)
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    const h = await fs.open(tmp, 'w')
    try {
      await h.writeFile(data, 'utf8')
      await h.sync()
    } finally {
      await h.close()
    }
    const check = await fs.readFile(tmp, 'utf8')
    if (sha256(check) !== expected) throw new VerifyError(`Verification failed while writing ${file}`)
    await retry(() => fs.rename(tmp, file))
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
  await fsyncDir(dir)
  const final = await retry(() => fs.readFile(file, 'utf8'))
  if (sha256(final) !== expected) throw new VerifyError(`Verification failed after saving ${file}`)
}

export async function writeJsonVerified(file: string, value: unknown): Promise<string> {
  const data = JSON.stringify(value, null, 1) + '\n'
  await writeFileVerified(file, data)
  return data
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(file: string): Promise<T> {
  const raw = await retry(() => fs.readFile(file, 'utf8'))
  return JSON.parse(raw) as T
}

/** Append a line and flush it to disk before returning. */
export async function appendDurable(file: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const h = await retry(() => fs.open(file, 'a'))
  try {
    await h.writeFile(line, 'utf8')
    await h.sync()
  } finally {
    await h.close()
  }
}
