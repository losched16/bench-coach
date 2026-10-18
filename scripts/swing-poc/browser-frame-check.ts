// Swing mechanics POC — does a real browser, seeking the way the review page
// seeks, show the frame the analyzer measured?
//
//   npx tsx scripts/swing-poc/browser-frame-check.ts <dir>
//
// <dir> is written by `python -m swing_analyzer validate` (browser-check/):
// the playback copy, manifest.json (frame times + frames to check) and, for
// each checked frame i, reference images of ORIGINAL frames i-1, i, i+1.
//
// For each frame: seek with seekTimeForFrame (the UI's own rule), draw the
// video to a canvas, and require it to match reference frame i better than
// i-1 and i+1. Served from 127.0.0.1 only; the files never leave the machine.
// Writes <dir>/result.json. Prints counts only.

import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import path from 'path'
import { seekTimeForFrame } from '../../lib/swingPoc/rules'

const dir = path.resolve(process.argv[2] || '')
if (!dir || !existsSync(path.join(dir, 'manifest.json'))) {
  console.error('usage: browser-frame-check.ts <browser-check dir>')
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
const times: number[] = manifest.frame_times_ms

const PAGE = `<!doctype html><meta charset="utf-8"><video id="v" muted playsinline preload="auto" src="/${manifest.video}"></video>
<script>
const W = 320, H = 240
function pixels(src) {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d'); g.drawImage(src, 0, 0, W, H)
  return g.getImageData(0, 0, W, H).data
}
function blockdiff(a, b) {
  // Largest mean |difference| over any 8×8 block (as analyzer/swing_analyzer/proxy.py).
  let worst = 0
  for (let by = 0; by + 8 <= H; by += 8) for (let bx = 0; bx + 8 <= W; bx += 8) {
    let s = 0
    for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) {
      const o = (y * W + x) * 4
      s += (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2])) / 3
    }
    worst = Math.max(worst, s / 64)
  }
  return worst
}
const img = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u })
window.check = async (seekS, refs) => {
  const v = document.getElementById('v')
  if (v.readyState < 1) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }))
  await new Promise(r => { v.addEventListener('seeked', r, { once: true }); v.currentTime = seekS })
  if (v.requestVideoFrameCallback) await new Promise(r => { v.requestVideoFrameCallback(() => r()); setTimeout(r, 500) })
  const shown = pixels(v)
  const out = {}
  for (const [k, u] of Object.entries(refs)) out[k] = blockdiff(shown, pixels(await img('/' + u)))
  return { diffs: out, currentTime: v.currentTime }
}
</script>`

const TYPES: Record<string, string> = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.png': 'image/png' }

async function main() {
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '')
    if (name === '' || name === 'index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE) }
    // Only plain file names inside <dir>.
    if (!/^[A-Za-z0-9._-]+$/.test(name)) { res.writeHead(404); return res.end() }
    const p = path.join(dir, name)
    if (!existsSync(p) || !statSync(p).isFile()) { res.writeHead(404); return res.end() }
    const body = readFileSync(p)
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
    const type = TYPES[path.extname(p)] || 'application/octet-stream'
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${body.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
      return res.end(body.subarray(start, end + 1))
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length })
    res.end(body)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as any).port
  let executablePath = process.env.CHROMIUM_PATH
  if (!executablePath) {
    const { execSync } = await import('child_process')
    executablePath = execSync("find /opt/pw-browsers -maxdepth 3 -path '*chrome-linux/chrome' -type f 2>/dev/null | head -1 || true").toString().trim() || undefined
  }
  const browser = await chromium.launch({ executablePath })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${port}/`)
  const results: any[] = []
  for (const c of manifest.checks) {
    const seekS = seekTimeForFrame(times, c.frame)
    const r = await page.evaluate(([s, refs]) => (window as any).check(s, refs), [seekS, c.refs] as const)
    const own = r.diffs[String(c.frame)]
    const others = Object.entries(r.diffs).filter(([k]) => k !== String(c.frame)).map(([, v]) => v as number)
    const matches = c.informative ? own < Math.min(...others) : true
    results.push({ frame: c.frame, seek_s: seekS, informative: c.informative, matches, diffs: r.diffs })
  }
  await browser.close()
  server.close()
  const all_match = results.every(r => r.matches)
  writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ all_match, results, browser: 'chromium (headless)' }, null, 1))
  console.log(JSON.stringify({ all_match, checked: results.length, informative: results.filter(r => r.informative).length }))
  process.exit(all_match ? 0 : 1)
}

main().catch(e => { console.error(String(e?.message || e).slice(0, 300)); process.exit(1) })
