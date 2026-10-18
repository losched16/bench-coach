// Swing mechanics POC — read a clip's frame timestamps (server only).
//
// The contact scrubber steps frame by frame, and on a variable-frame-rate
// phone clip "frame by frame" means the file's own presentation times, not
// 1/fps. ffprobe gives those in a fraction of a second; the full analysis
// still runs in the worker. If ffprobe is missing the scrubber falls back to
// fine time steps and says so.

import { execFile } from 'child_process'

export interface ProbeInfo {
  frame_times_ms: number[]
  width: number | null
  height: number | null
  rotation: number
}

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', args, { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout))
  })
}

export async function probeFrames(file: string): Promise<ProbeInfo | null> {
  try {
    const meta = JSON.parse(await run(['-v', 'error', '-print_format', 'json', '-show_streams', '-select_streams', 'v:0', file]))
    const s = (meta.streams || [])[0]
    if (!s) return null
    let rotation = 0
    for (const sd of s.side_data_list || []) if (sd.rotation != null) rotation = Math.round(Number(sd.rotation)) || 0
    const csv = await run(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', file])
    const raw = csv.split('\n').map(l => parseFloat(l.split(',')[0])).filter(Number.isFinite)
    if (!raw.length) return null
    const t0 = raw[0]
    const swap = Math.abs(rotation) === 90
    return {
      frame_times_ms: raw.map(t => Math.round((t - t0) * 1e6) / 1e3),
      width: swap ? s.height : s.width,
      height: swap ? s.width : s.height,
      rotation,
    }
  } catch {
    return null
  }
}
