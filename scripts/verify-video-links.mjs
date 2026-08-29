// Every YouTube URL goes through lib/drillVideo.ts.
//
// This exists because the alternative was tried and failed silently for
// months. youtube_start_seconds has been in the schema since migration 036 and
// in DRILL_FIELDS the whole time, and it reached two of the ten places that
// render a video — because the other eight each built their own URL inline:
//
//     href={d.youtube_url || `https://www.youtube.com/watch?v=${d.youtube_video_id}`}
//
// Nothing was broken in a way anyone could see. The links worked. They just
// went to 0:00 of a twelve-minute compilation, which is the difference between
// a drill recommendation and a folder of YouTube links, and no test could have
// caught it because there was nothing to catch — the timestamp simply was not
// part of the URL those files built.
//
// So: fail the build if a surface constructs a YouTube URL by hand. Adding
// timestamp data later is worth nothing if only some of the app can show it.
//
//   node scripts/verify-video-links.mjs

import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const ROOTS = ['app', 'components', 'lib']
const HELPER = 'lib/drillVideo.ts'

// Files allowed to name YouTube hosts directly.
const EXEMPT = new Set([
  // The helper itself is where the URLs are supposed to be built.
  'lib/drillVideo.ts',
  // The admin link checker calls the oembed API to see whether a video still
  // exists. That is a different job from linking a coach to a drill, and it
  // deliberately does not want a timestamp.
  'app/api/admin/verify-links/route.ts',
])

// Constructing a YouTube URL: a literal host in something that becomes a link
// or an embed. Matching the host rather than the whole expression, because the
// eight inline versions were all spelled slightly differently.
const PATTERNS = [
  { re: /youtube\.com\/watch/, what: 'a watch URL' },
  { re: /youtube(?:-nocookie)?\.com\/embed/, what: 'an embed URL' },
  { re: /youtu\.be\//, what: 'a short URL' },
  { re: /img\.youtube\.com/, what: 'a thumbnail URL' },
  { re: /i\.ytimg\.com/, what: 'a thumbnail URL' },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const files = ROOTS.flatMap(r => {
  try { return walk(r) } catch { return [] }
})

const violations = []
let checked = 0

for (const file of files) {
  const rel = file.replace(/\\/g, '/')
  if (EXEMPT.has(rel)) continue
  checked++

  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Comments explain the old shape on purpose — including in this file's own
    // sibling modules — and an assertion that cannot tell a description of the
    // bug from the bug is worse than no assertion.
    const t = line.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
    // A static string is not a constructed URL. `placeholder="https://
    // youtube.com/watch?v=…"` tells a coach what to paste into a form; it is
    // never fetched, never linked, and has no drill to carry a timestamp.
    // What matters is interpolation, or a real href/src.
    const constructs = line.includes('${') || /\b(href|src)\s*=/.test(line)
    if (!constructs) continue

    for (const { re, what } of PATTERNS) {
      if (re.test(line)) {
        violations.push({ file: rel, line: i + 1, what, src: t.slice(0, 100) })
        break
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `\nYouTube URLs must be built by ${HELPER}, not inline.\n\n` +
    `Use watchUrl(drill), embedUrl(drill) or thumbnailUrl(drill). They apply\n` +
    `youtube_start_seconds so a drill anchored to part of a compilation opens\n` +
    `where the drill actually is. An inline URL silently drops it.\n`
  )
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  builds ${v.what}`)
    console.error(`      ${v.src}`)
  }
  console.error('')
  process.exit(1)
}

console.log(
  `Checked ${checked} files (${EXEMPT.size} exempt) — every YouTube URL is built by ` +
  `${HELPER}, so a drill's start timestamp reaches every surface that links to it.`
)
