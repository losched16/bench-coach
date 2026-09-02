// Shared plumbing for the drill-intelligence pilot scripts.
//
// Everything under scripts/pilot/ is READ-ONLY with respect to production.
// The only Supabase access is a SELECT over PostgREST, and the only files
// written live under pilot/. There is no code path here that can reach
// drill_resources, problem_taxonomy or drill_problem_map with a write, and
// that is deliberate: this is data preparation for a human/AI review layer,
// not an import.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { execFileSync, spawnSync } from 'child_process'

export const ROOT = process.cwd()
export const PILOT = join(ROOT, 'pilot')
export const P = {
  reference: join(PILOT, 'reference'),
  input: join(PILOT, 'input', 'instagram-calibration.json'),
  media: join(PILOT, 'media'),
  manifest: join(PILOT, 'calibration-manifest.json'),
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

export function exists(path) {
  return existsSync(path)
}

export function fileSize(path) {
  try { return statSync(path).size } catch { return 0 }
}

// Instagram shortcodes are 11 characters of [A-Za-z0-9_-]. Anything else is
// a typo, and a typo here becomes a directory name.
export const SHORTCODE = /^[A-Za-z0-9_-]{11}$/

export function assertShortcode(s) {
  if (!SHORTCODE.test(String(s || ''))) {
    throw new Error(`not an Instagram shortcode: ${JSON.stringify(s)}`)
  }
  return s
}

// ---------------------------------------------------------------------------
// ffmpeg / ffprobe
//
// Resolved in order: $FFMPEG_PATH, ffmpeg on PATH, the imageio-ffmpeg wheel
// under pilot/.tools. The wheel route exists because this environment cannot
// reach GitHub releases (which is where ffmpeg-static downloads from) but can
// reach PyPI, and imageio-ffmpeg ships the binary inside the wheel itself.
// ---------------------------------------------------------------------------

function findInTools(prefix) {
  const dir = join(PILOT, '.tools', 'py', 'imageio_ffmpeg', 'binaries')
  if (!existsSync(dir)) return null
  const r = spawnSync('sh', ['-c', `ls "${dir}" | grep '^${prefix}-linux' | head -1`], { encoding: 'utf8' })
  const name = (r.stdout || '').trim()
  return name ? join(dir, name) : null
}

export function ffmpegPath() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH
  const onPath = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' }).stdout.trim()
  if (onPath) return onPath
  const wheel = findInTools('ffmpeg')
  if (wheel) return wheel
  throw new Error(
    'ffmpeg not found. Either install it on PATH, set FFMPEG_PATH, or run:\n' +
    '  pip install --target pilot/.tools/py imageio-ffmpeg'
  )
}

// imageio-ffmpeg does not ship ffprobe. ffmpeg itself can report duration
// (it prints it to stderr on any input), so probing goes through ffmpeg.
export function probeDurationSeconds(file) {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const m = (r.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export function ffmpeg(args, opts = {}) {
  return execFileSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  })
}

// ---------------------------------------------------------------------------
// Supabase, read-only
// ---------------------------------------------------------------------------

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and a Supabase key are required')
  if (!process.env.NODE_USE_ENV_PROXY) {
    console.error(
      'NOTE: NODE_USE_ENV_PROXY is not set. In the remote build environment Node\'s ' +
      'fetch ignores HTTPS_PROXY and Supabase calls fail with a 403 that looks like ' +
      'an auth error. Run with NODE_USE_ENV_PROXY=1 if that happens.'
    )
  }
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}` } }
}

/** SELECT every row of a table, paged. GET only — there is no write here. */
export async function selectAll(table, order) {
  const { url, headers } = supabaseEnv()
  const out = []
  let from = 0
  for (;;) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&order=${order}`, {
      headers: { ...headers, Range: `${from}-${from + 999}` },
    })
    const rows = await res.json()
    if (!Array.isArray(rows)) throw new Error(`${table}: ${JSON.stringify(rows).slice(0, 200)}`)
    out.push(...rows)
    if (rows.length < 1000) break
    from += 1000
  }
  return out
}

export function nowIso() {
  return new Date().toISOString()
}
