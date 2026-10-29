import { gunzipSync, gzipSync } from 'node:zlib'
import { del, list, put } from '@vercel/blob'

/** `rev` counts rewrites of the published files; a client whose cache has a lower rev downloads again even for the same date. */
export interface FileRef { file: string; date: string; rev?: number }

export interface Manifest {
  version: 1
  /** Version of the rules that built the published data (see DATA_VERSION). A mismatch makes the next ingest rebuild. */
  dataVersion?: number
  /** Last session folded into the history, or null before the first run. */
  latestDate: string | null
  /** One snapshot per exchange. All share `latestDate`. */
  snapshots: Partial<Record<'NSE' | 'BSE', FileRef>>
  /** Single-day updates after the snapshots, oldest first, one file per exchange per day. */
  deltas: (FileRef & { ex: 'NSE' | 'BSE' })[]
  indices: FileRef | null
  /** Company metadata (ISIN, names, industries) and the search list, both rebuilt when a snapshot is written. */
  meta: FileRef | null
  search: FileRef | null
  /** Whole-market summary (breadth, highs and lows, top movers) for the latest session. */
  pulse: FileRef | null
  rev: number
  updatedAt: string
  /**
   * A rebuild in progress. Clients ignore it and keep using the fields above; it is swapped in (and removed) once it has caught
   * up with `latestDate`, so a rebuild cut short by the time budget never publishes a partial history.
   */
  staging?: Manifest
  /** Public URLs by file name, so clients need no knowledge of the storage host. */
  urls: Record<string, string>
}

export const emptyManifest = (): Manifest => ({ version: 1, latestDate: null, snapshots: {}, deltas: [], indices: null, meta: null, search: null, pulse: null, rev: 0, updatedAt: new Date(0).toISOString(), urls: {} })

/** Where data files live. Blob in production, memory in tests. Everything is stored gzipped except the manifest. */
export interface Store {
  getManifest(): Promise<Manifest | null>
  putManifest(m: Manifest): Promise<void>
  getJson<T>(file: string): Promise<T | null>
  /** Returns the public URL. */
  putJson(file: string, value: unknown): Promise<string>
  remove(files: string[]): Promise<void>
}

const gz = (v: unknown) => gzipSync(Buffer.from(JSON.stringify(v)), { level: 9 })

export function blobStore(token?: string): Store {
  const opts = token ? { token } : {}
  const find = async (pathname: string) => (await list({ prefix: pathname, limit: 5, ...opts })).blobs.find(b => b.pathname === pathname)
  return {
    async getManifest() {
      const b = await find('data/manifest.json')
      if (!b) return null
      const res = await fetch(`${b.url}?t=${Date.now()}`)
      return res.ok ? ((await res.json()) as Manifest) : null
    },
    async putManifest(m) {
      // Short CDN lifetime: clients should see a new day within minutes, but a burst of clients should not all reach the origin.
      await put('data/manifest.json', JSON.stringify(m), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 300, ...opts })
    },
    async getJson<T>(file: string) {
      const b = await find(`data/${file}`)
      if (!b) return null
      const res = await fetch(`${b.url}?t=${Date.now()}`)
      return res.ok ? (JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8')) as T) : null
    },
    async putJson(file, value) {
      // Files are immutable per name (dated), so they can be cached for a long time.
      const r = await put(`data/${file}`, gz(value), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/octet-stream', cacheControlMaxAge: 31_536_000, ...opts })
      return r.url
    },
    async remove(files) {
      if (!files.length) return
      const names = new Set(files.map(f => `data/${f}`))
      const all = (await list({ prefix: 'data/', limit: 1000, ...opts })).blobs
      const urls = all.filter(b => names.has(b.pathname)).map(b => b.url)
      if (urls.length) await del(urls, opts)
    },
  }
}

/** In-memory store for tests and local runs. */
export function memoryStore(): Store & { files: Map<string, Buffer>; manifest: () => Manifest | null; puts: () => number } {
  const files = new Map<string, Buffer>()
  let manifest: Manifest | null = null
  let puts = 0
  return {
    files, manifest: () => manifest, puts: () => puts,
    async getManifest() { return manifest ? (JSON.parse(JSON.stringify(manifest)) as Manifest) : null },
    async putManifest(m) { puts++; manifest = JSON.parse(JSON.stringify(m)) as Manifest },
    async getJson<T>(file: string) { const b = files.get(file); return b ? (JSON.parse(gunzipSync(b).toString('utf8')) as T) : null },
    async putJson(file, value) { puts++; files.set(file, gz(value)); return `memory://${file}` },
    async remove(names) { for (const n of names) files.delete(n) },
  }
}
