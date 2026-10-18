// Swing mechanics POC — private local capture store (server only).
//
// Deliberately NOT Supabase storage: running the POC must not be able to touch
// production buckets. Files live under SWING_POC_DATA_DIR, outside public/ and
// git-ignored, and are only ever served through an authorized route with a
// short-lived signed token. The Python worker (analyzer/swing_analyzer/worker.py)
// reads and writes the same layout:
//
//   captures/<id>/meta.json     who it belongs to, file facts, contact history
//   captures/<id>/video.<ext>   the upload
//   captures/<id>/job.json      queued → processing → done | failed
//   captures/<id>/result.json   analyzer output (swing-pose/1)
//   captures/<id>/review.json   the coach's review of each finding
//   queue/<id>.json             a request for analysis

import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { promises as fs, createWriteStream } from 'fs'
import path from 'path'

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
export const ALLOWED_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
}
export const VIDEO_TOKEN_TTL_S = 300

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export class StoreError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function dataDir(): string {
  return path.resolve(process.env.SWING_POC_DATA_DIR || path.join(process.cwd(), '.swing-poc-data'))
}

/** Capture ids are server-generated UUIDs. Anything else never reaches a path. */
export function captureDir(id: string): string {
  if (!ID_RE.test(String(id || ''))) throw new StoreError('Capture not found', 404)
  return path.join(dataDir(), 'captures', id)
}

export interface ContactMark {
  t_ms: number
  frame: number | null
  set_by: string
  set_at: string
}

export interface CaptureMeta {
  id: string
  team_id: string
  player_id: string
  created_by: string
  created_at: string
  original_name: string
  mime_type: string
  size_bytes: number
  ext: string
  handedness: 'R' | 'L' | null
  camera_view: 'face_on' | 'down_the_line' | 'other' | null
  setting: 'tee' | 'front_toss' | 'live' | 'other' | null
  // Every contact mark the coach has made, newest last. The analysis uses the
  // newest; the history is provenance.
  contact_history: ContactMark[]
  // Coach-tagged events the analyzer does not estimate (load, swing start)
  // and coach corrections to ones it does (foot strike).
  event_tags: Record<string, { t_ms: number; set_by: string; set_at: string } | null>
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(p: string, data: unknown): Promise<void> {
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, JSON.stringify(data))
  await fs.rename(tmp, p)
}

export function extFor(mime: string): string | null {
  return ALLOWED_TYPES[String(mime || '').toLowerCase()] ?? null
}

/**
 * Store an upload. The body is streamed to disk and the size limit is enforced
 * on the bytes actually received, not on a header the client chose.
 */
export async function createCapture(input: {
  teamId: string
  playerId: string
  userId: string
  originalName: string
  mimeType: string
  body: ReadableStream<Uint8Array>
  handedness?: string | null
  cameraView?: string | null
  setting?: string | null
}): Promise<CaptureMeta> {
  const ext = extFor(input.mimeType)
  if (!ext) throw new StoreError('Upload an MP4, MOV or WebM video.', 415)
  const id = randomUUID()
  const dir = captureDir(id)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `video.${ext}`)

  let received = 0
  const out = createWriteStream(file, { flags: 'wx' })
  const reader = input.body.getReader()
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_UPLOAD_BYTES) {
        throw new StoreError(`The video is over ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB. Trim it to the swing.`, 413)
      }
      if (!out.write(value)) await new Promise<void>(r => out.once('drain', () => r()))
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  } catch (e) {
    out.destroy()
    await fs.rm(dir, { recursive: true, force: true })
    throw e
  }
  if (received === 0) {
    await fs.rm(dir, { recursive: true, force: true })
    throw new StoreError('The upload was empty — it may have been interrupted. Try again.', 400)
  }

  const meta: CaptureMeta = {
    id,
    team_id: input.teamId,
    player_id: input.playerId,
    created_by: input.userId,
    created_at: new Date().toISOString(),
    original_name: String(input.originalName || 'swing').slice(0, 120),
    mime_type: input.mimeType,
    size_bytes: received,
    ext,
    handedness: input.handedness === 'R' || input.handedness === 'L' ? input.handedness : null,
    camera_view: (['face_on', 'down_the_line', 'other'] as const).find(v => v === input.cameraView) ?? null,
    setting: (['tee', 'front_toss', 'live', 'other'] as const).find(v => v === input.setting) ?? null,
    contact_history: [],
    event_tags: {},
  }
  await writeJson(path.join(dir, 'meta.json'), meta)
  return meta
}

export async function readMeta(id: string): Promise<CaptureMeta> {
  const meta = await readJson<CaptureMeta>(path.join(captureDir(id), 'meta.json'))
  if (!meta) throw new StoreError('Capture not found', 404)
  return meta
}

export async function writeMeta(meta: CaptureMeta): Promise<void> {
  await writeJson(path.join(captureDir(meta.id), 'meta.json'), meta)
}

export function videoPath(meta: CaptureMeta): string {
  return path.join(captureDir(meta.id), `video.${meta.ext}`)
}

export async function listCaptures(teamId: string, playerId: string): Promise<CaptureMeta[]> {
  const root = path.join(dataDir(), 'captures')
  let names: string[] = []
  try {
    names = await fs.readdir(root)
  } catch {
    return []
  }
  const out: CaptureMeta[] = []
  for (const n of names) {
    if (!ID_RE.test(n)) continue
    const m = await readJson<CaptureMeta>(path.join(root, n, 'meta.json'))
    if (m && m.team_id === teamId && m.player_id === playerId) out.push(m)
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export interface AnalysisRequest {
  contact_ms: number
  handedness: 'R' | 'L' | null
  camera_view: string | null
  // The coach's foot-strike mark, when they corrected the automatic estimate.
  foot_strike_ms?: number | null
}

export async function enqueue(meta: CaptureMeta, request: AnalysisRequest): Promise<void> {
  const root = dataDir()
  await fs.mkdir(path.join(root, 'queue'), { recursive: true })
  const dir = captureDir(meta.id)
  const prev = (await readJson<any>(path.join(dir, 'job.json'))) || {}
  await writeJson(path.join(dir, 'job.json'), {
    ...prev, state: 'queued', request, updated_at: new Date().toISOString(), error: null,
  })
  await writeJson(path.join(root, 'queue', `${meta.id}.json`), request)
}

export async function readJob(id: string): Promise<any | null> {
  return readJson(path.join(captureDir(id), 'job.json'))
}

export async function readResult(id: string): Promise<any | null> {
  return readJson(path.join(captureDir(id), 'result.json'))
}

export async function readReview(id: string): Promise<any | null> {
  return readJson(path.join(captureDir(id), 'review.json'))
}

export async function writeReview(id: string, review: unknown): Promise<void> {
  await writeJson(path.join(captureDir(id), 'review.json'), review)
}

/** Remove a capture and everything derived from it (retention / coach delete). */
export async function deleteCapture(id: string): Promise<void> {
  await fs.rm(captureDir(id), { recursive: true, force: true })
  await fs.rm(path.join(dataDir(), 'queue', `${id}.json`), { force: true })
}

// ── signed video access ─────────────────────────────────────────────────────

function secret(): string {
  const s = process.env.SWING_POC_SIGNING_SECRET
  if (!s || s.length < 32) {
    throw new StoreError('SWING_POC_SIGNING_SECRET is not set (32+ characters).', 500)
  }
  return s
}

/**
 * A token for one capture, one user, a few minutes. The video route still
 * re-authorizes the caller; the token stops a copied URL working for anyone
 * else or for long.
 */
export function signVideo(captureId: string, userId: string, now = Date.now(), ttlS = VIDEO_TOKEN_TTL_S): string {
  const exp = Math.floor(now / 1000) + ttlS
  const sig = createHmac('sha256', secret()).update(`${captureId}.${userId}.${exp}`).digest('base64url')
  return `${exp}.${sig}`
}

export function verifyVideo(captureId: string, userId: string, token: string, now = Date.now()): boolean {
  const [expStr, sig] = String(token || '').split('.')
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || !sig || exp < Math.floor(now / 1000)) return false
  const want = createHmac('sha256', secret()).update(`${captureId}.${userId}.${exp}`).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}
