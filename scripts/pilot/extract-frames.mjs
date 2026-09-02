// Task 4 — representative frames and a contact sheet for each local video.
//
// A multimodal reviewer needs to SEE the drill, and a reel is thirty seconds
// of motion. Twelve well-chosen stills beat a thousand near-identical ones:
// the first frame (setup), the last (finish), a steady cadence between, and
// the moments the picture actually changes — a new angle, a new drill in a
// circuit. Anything within 1.5s of a frame already kept is dropped, which is
// what keeps a 164-second source at a few dozen frames rather than a hundred.
//
//   node scripts/pilot/extract-frames.mjs                 every downloaded source
//   node scripts/pilot/extract-frames.mjs DccQM89N1vx     one
//   node scripts/pilot/extract-frames.mjs --video path.mp4 --out dir   any file
//
// Writes, per source:
//   pilot/media/<shortcode>/frames/frame-NNN-<seconds>s.jpg
//   pilot/media/<shortcode>/frames.json         filename + timestamp_seconds
//   pilot/media/<shortcode>/contact-sheet.jpg

import { join, basename } from 'path'
import { mkdirSync, readdirSync, unlinkSync } from 'fs'
import { spawnSync } from 'child_process'
import { readJson, writeJson, exists, ffmpeg, ffmpegPath, probeDurationSeconds, nowIso, P } from './lib.mjs'

// Cadence by length: a 30-second reel every 4s is ~9 frames plus edges and
// scene changes, which lands in the 8-15 the brief asks for. Longer sources
// slow the cadence rather than multiplying the frame count.
function intervalFor(duration) {
  if (duration <= 45) return 4
  if (duration <= 90) return 6
  return 8
}

const MIN_GAP = 1.5

/**
 * Timestamps where ffmpeg's scene detector thinks the picture changed.
 * showinfo writes to stderr, so this runs ffmpeg with stderr captured.
 */
function detectScenes(video, threshold = 0.35) {
  const r = spawnSync(ffmpegPath(), [
    '-hide_banner', '-i', video,
    '-vf', `select='gt(scene,${threshold})',showinfo`,
    '-vsync', 'vfr', '-f', 'null', '-',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const times = []
  for (const m of (r.stderr || '').matchAll(/pts_time:(\d+(?:\.\d+)?)/g)) times.push(Number(m[1]))
  return times
}

export function planTimestamps(duration, scenes = []) {
  const step = intervalFor(duration)
  const wanted = [0]
  for (let t = step; t < duration - 0.5; t += step) wanted.push(t)
  wanted.push(Math.max(0, duration - 0.25))
  for (const s of scenes) wanted.push(s)

  wanted.sort((a, b) => a - b)
  const kept = []
  for (const t of wanted) {
    if (kept.length === 0 || t - kept[kept.length - 1] >= MIN_GAP) kept.push(Number(t.toFixed(2)))
  }
  return kept
}

export function extractFor(video, outDir, label) {
  const duration = probeDurationSeconds(video)
  if (!duration) throw new Error(`${video}: ffmpeg cannot read a duration`)

  const framesDir = join(outDir, 'frames')
  mkdirSync(framesDir, { recursive: true })
  for (const f of readdirSync(framesDir)) if (f.endsWith('.jpg')) unlinkSync(join(framesDir, f))

  const scenes = detectScenes(video)
  const stamps = planTimestamps(duration, scenes)

  const frames = []
  stamps.forEach((t, i) => {
    const name = `frame-${String(i + 1).padStart(3, '0')}-${t.toFixed(1)}s.jpg`
    // -ss before -i seeks by keyframe then decodes forward to the exact time:
    // accurate, and fast enough at this frame count.
    ffmpeg(['-ss', String(t), '-i', video, '-frames:v', '1', '-q:v', '2', '-y', join(framesDir, name)])
    frames.push({
      filename: `frames/${name}`,
      timestamp_seconds: t,
      reason: t === 0 ? 'opening' : (i === stamps.length - 1 ? 'final' : (scenes.some(s => Math.abs(s - t) < 0.01) ? 'scene-change' : 'cadence')),
    })
  })

  // Contact sheet: every frame at 320px wide, four across, timestamp burned in
  // so a reviewer can cite "the frame at 12.0s" without opening frames.json.
  const cols = 4
  const rows = Math.ceil(frames.length / cols)
  const inputs = frames.flatMap(f => ['-i', join(outDir, f.filename)])
  const labels = frames.map((f, i) =>
    `[${i}:v]scale=320:-2,drawtext=text='${f.timestamp_seconds.toFixed(1)}s':x=6:y=6:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4[f${i}]`
  ).join(';')
  const concat = frames.map((_, i) => `[f${i}]`).join('')
  const sheet = join(outDir, 'contact-sheet.jpg')
  let labelled = true
  try {
    // stderr discarded on this attempt: the static imageio build has no
    // drawtext, and the "Filter not found" it prints is expected, not news.
    ffmpeg([...inputs, '-filter_complex', `${labels};${concat}xstack=inputs=${frames.length}:layout=${gridLayout(frames.length, cols)}[out]`,
      '-map', '[out]', '-q:v', '3', '-y', sheet], { stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    // drawtext needs fontconfig, which a static build may lack. Fall back to
    // an unlabelled sheet rather than no sheet; frames.json still has times.
    labelled = false
    const plain = frames.map((_, i) => `[${i}:v]scale=320:-2[f${i}]`).join(';')
    ffmpeg([...inputs, '-filter_complex', `${plain};${concat}xstack=inputs=${frames.length}:layout=${gridLayout(frames.length, cols)}[out]`,
      '-map', '[out]', '-q:v', '3', '-y', sheet])
  }

  const manifest = {
    shortcode: label,
    video: basename(video),
    duration_seconds: duration,
    extracted_at: nowIso(),
    cadence_seconds: intervalFor(duration),
    scene_changes_detected: scenes.length,
    frame_count: frames.length,
    contact_sheet: 'contact-sheet.jpg',
    contact_sheet_labelled: labelled,
    frames,
  }
  writeJson(join(outDir, 'frames.json'), manifest)
  return manifest
}

// xstack needs explicit pixel offsets. All tiles are 320 wide; heights vary
// by aspect ratio, so rows are placed using the tallest plausible tile (vertical
// reels are 320x569) and the sheet is trimmed by the codec's edge handling.
function gridLayout(n, cols) {
  const w = 320, h = 570
  const cells = []
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols)
    cells.push(`${c * w}_${r * h}`)
  }
  return cells.join('|')
}

if (process.argv[1] && process.argv[1].endsWith('extract-frames.mjs')) {
  const argv = process.argv.slice(2)
  const vi = argv.indexOf('--video')
  if (vi !== -1) {
    const video = argv[vi + 1]
    const oi = argv.indexOf('--out')
    const out = oi !== -1 ? argv[oi + 1] : join(P.media, '_adhoc')
    const m = extractFor(video, out, basename(video))
    console.log(`  ${basename(video)}  ${m.duration_seconds.toFixed(1)}s  ${m.frame_count} frames  (${m.scene_changes_detected} scene changes)  -> ${out}`)
    process.exit(0)
  }

  const only = argv[0]
  const input = readJson(P.input)
  const targets = input.sources.filter(s => (!only || s.shortcode === only))
  let done = 0
  for (const s of targets) {
    const dir = join(P.media, s.shortcode)
    const video = join(dir, 'source.mp4')
    if (!exists(video)) { console.log(`  ${s.shortcode}  skipped — no local video`); continue }
    const m = extractFor(video, dir, s.shortcode)
    done++
    console.log(`  ${s.shortcode}  ${m.duration_seconds.toFixed(1)}s  ${m.frame_count} frames  (${m.scene_changes_detected} scene changes)`)
  }
  console.log(`\n${done}/${targets.length} sources processed.`)
}
