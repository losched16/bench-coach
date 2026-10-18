// Swing mechanics POC — the app-side rules, store and gates.
//
//   npm run test:swing-poc
//
// Pure and filesystem tests; no network, no model. The browser + worker proof
// is scripts/swing-poc/run-e2e.sh, and the analyzer's own tests are
// analyzer/tests (Python).

import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}
async function throws(fn: () => Promise<unknown> | unknown, re?: RegExp): Promise<string | null> {
  try { await fn() } catch (e: any) { return re && !re.test(e.message) ? `wrong error: ${e.message}` : null }
  return 'did not throw'
}

process.env.SWING_POC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'swingpoc-'))
process.env.SWING_POC_SIGNING_SECRET = 'x'.repeat(48)

function stream(bytes: number, chunk = 64 * 1024): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(c) {
      if (sent >= bytes) return c.close()
      const n = Math.min(chunk, bytes - sent)
      sent += n
      c.enqueue(new Uint8Array(n))
    },
  })
}

async function main() {
  const R = await import('../lib/swingPoc/rules')
  const S = await import('../lib/swingPoc/store')

  // ── flag ──────────────────────────────────────────────────────────────────
  delete process.env.SWING_MECHANICS_POC
  check('the POC is off unless the flag is exactly "1"', !R.swingPocEnabled())
  process.env.SWING_MECHANICS_POC = 'true'
  check('..."true" does not turn it on', !R.swingPocEnabled())
  process.env.SWING_MECHANICS_POC = '1'
  check('...and "1" does', R.swingPocEnabled())

  // ── timeline sync ─────────────────────────────────────────────────────────
  // Variable frame rate: 16.7 ms and 50 ms gaps, as a phone slow-mo clip.
  const vfr = [0, 16.667, 66.667, 83.333, 133.333].map((t, i) => ({ i, t_ms: t, flags: [] }))
  check('frameAt draws the frame on screen at that time (VFR)', R.frameAt(vfr, 70, 50)?.i === 2)
  check('...a frame stays up until the next frame\'s timestamp, however long the gap', R.frameAt(vfr, 41.5, 50)?.i === 1 && R.frameAt(vfr, 120, 50)?.i === 3)
  check('...matched by time, not index × fps (33.3 × 3 = 99.9 ms is frame 3 here, not 3 at 30 fps)', R.frameAt(vfr, 99.9, 50)?.i === 3)
  check('...nothing before the analysed window or after it', R.frameAt(vfr, -50, 50) === null && R.frameAt(vfr, 400, 50) === null)
  const strided = [{ i: 0, t_ms: 0, flags: [] }, { i: 3, t_ms: 100, flags: [] }]
  check('...and no stale pose on frames the analysis skipped', R.frameAt(strided, 50, 34) === null && R.frameAt(strided, 20, 34)?.i === 0)
  const times = [0, 33.333, 66.667, 100]
  check('seeking lands inside the requested frame, not on its neighbour',
    R.seekTimeForFrame(times, 2) * 1000 > 66.667 && R.seekTimeForFrame(times, 2) * 1000 < 100)
  const portrait = R.contentRect(400, 400, 1080, 1920)
  check('a portrait video is letterboxed, and landmarks map to the picture, not the box',
    Math.abs(portrait.w - 225) < 0.01 && Math.abs(portrait.x - 87.5) < 0.01 && portrait.y === 0)
  const land = R.contentRect(400, 400, 1920, 1080)
  check('...and a landscape one too', Math.abs(land.h - 225) < 0.01 && Math.abs(land.y - 87.5) < 0.01)

  // ── coach review ──────────────────────────────────────────────────────────
  const result = {
    input_hash: 'h1',
    observations: [
      { id: 'lead_foot_movement', status: 'observed', drill_taxonomy: ['stepping-in-bucket', 'lunging'], label: 'Stride' },
      { id: 'forward_move', status: 'observed', drill_taxonomy: ['lunging', 'pulling-head'], label: 'Forward move' },
      { id: 'hip_shoulder_separation', status: 'not_assessable', drill_taxonomy: [], label: 'Hip–shoulder' },
    ],
  }
  let rv = R.applyReview(null, result, { findingId: 'lead_foot_movement', state: 'accepted' }, 'u1')
  check('a coach can accept an observed finding', rv.findings.lead_foot_movement.state === 'accepted' && rv.findings.lead_foot_movement.reviewed_by === 'u1')
  check('a review never writes the player record', rv.writes_player_record === false)
  check('a not-assessable finding cannot be accepted',
    (await throws(() => R.applyReview(rv, result, { findingId: 'hip_shoulder_separation', state: 'accepted' }, 'u1'), /nothing to accept/)) === null)
  check('...but can be confirmed as not assessable',
    R.applyReview(rv, result, { findingId: 'hip_shoulder_separation', state: 'not_assessable' }, 'u1').findings.hip_shoulder_separation.state === 'not_assessable')
  check('editing needs the coach\'s wording',
    (await throws(() => R.applyReview(rv, result, { findingId: 'forward_move', state: 'edited' }, 'u1'), /wording/)) === null)
  check('a finding the analysis did not produce cannot be reviewed',
    (await throws(() => R.applyReview(rv, result, { findingId: 'exit_velocity', state: 'accepted' }, 'u1'), /not part/)) === null)
  check('an unknown state is refused',
    (await throws(() => R.applyReview(rv, result, { findingId: 'forward_move', state: 'validated' }, 'u1'), /Unknown/)) === null)
  const rerun = { ...result, input_hash: 'h2' }
  check('decisions about an older analysis do not carry over to a re-analysis',
    R.acceptedFindings(rv, rerun).length === 0)
  rv = R.applyReview(rv, result, { findingId: 'forward_move', state: 'edited', note: 'Drifts forward before the hands go' }, 'u1')
  const acc = R.acceptedFindings(rv, result)
  check('accepted and edited findings are the ones that lead to drills', acc.map(a => a.id).join() === 'lead_foot_movement,forward_move')
  check('...with the coach\'s wording', acc[1].note === 'Drifts forward before the hands go')
  const rejected = R.applyReview(rv, result, { findingId: 'lead_foot_movement', state: 'rejected' }, 'u1')
  check('a rejected finding leads to no drills', !R.acceptedFindings(rejected, result).some(a => a.id === 'lead_foot_movement'))
  const dx = R.drillDiagnosis(acc)
  check('drill retrieval gets only the registry\'s taxonomy slugs for accepted findings',
    dx.slugs.join() === 'stepping-in-bucket,lunging,pulling-head' && dx.via === 'aliases')
  check('no accepted finding, no diagnosis', R.drillDiagnosis([]).slugs.length === 0)

  // ── store ─────────────────────────────────────────────────────────────────
  check('a capture id that is not a server UUID never becomes a path',
    (await throws(() => S.captureDir('../../etc'), /not found/)) === null &&
    (await throws(() => S.captureDir('a/b'), /not found/)) === null)
  check('non-video uploads are refused',
    (await throws(() => S.createCapture({ teamId: 't', playerId: 'p', userId: 'u', originalName: 'x.html', mimeType: 'text/html', body: stream(10) }), /MP4/)) === null)
  check('an empty upload is refused and leaves nothing behind',
    (await throws(() => S.createCapture({ teamId: 't', playerId: 'p', userId: 'u', originalName: 'x.mp4', mimeType: 'video/mp4', body: stream(0) }), /empty/)) === null)
  check('an oversize upload is cut off on the bytes received, not a header',
    (await throws(() => S.createCapture({ teamId: 't', playerId: 'p', userId: 'u', originalName: 'x.mp4', mimeType: 'video/mp4', body: stream(S.MAX_UPLOAD_BYTES + 1, 4 * 1024 * 1024) }), /over/)) === null)
  const left = readdirSync(path.join(process.env.SWING_POC_DATA_DIR!, 'captures'))
  check('...and the partial file is deleted', left.length === 0, left.join(','))

  const meta = await S.createCapture({ teamId: 'team-a', playerId: 'player-1', userId: 'u1', originalName: 'swing.mp4', mimeType: 'video/mp4', body: stream(1234), handedness: 'R', cameraView: 'face_on', setting: 'tee' })
  check('a capture is stored with its owner team and player', meta.team_id === 'team-a' && meta.player_id === 'player-1' && meta.size_bytes === 1234)
  check('the video is stored outside the public web root', !S.videoPath(meta).includes(`${path.sep}public${path.sep}`))
  check('invalid annotations are dropped, not stored', (await S.createCapture({ teamId: 't', playerId: 'p', userId: 'u', originalName: 'x', mimeType: 'video/webm', body: stream(5), handedness: 'X', cameraView: 'drone' })).handedness === null)
  check('captures are listed per team AND player', (await S.listCaptures('team-a', 'player-1')).length === 1 && (await S.listCaptures('team-b', 'player-1')).length === 0)

  await S.enqueue(meta, { contact_ms: 1666.667, handedness: 'R', camera_view: 'face_on' })
  const q = path.join(process.env.SWING_POC_DATA_DIR!, 'queue', `${meta.id}.json`)
  check('analysis is a queued job file, not work in the request', existsSync(q) && (await S.readJob(meta.id)).state === 'queued')
  check('...carrying the coach-marked contact', JSON.parse(readFileSync(q, 'utf8')).contact_ms === 1666.667)

  const now = Date.now()
  const tok = S.signVideo(meta.id, 'u1', now)
  check('a signed video link works for its user and capture', S.verifyVideo(meta.id, 'u1', tok, now))
  check('...not for another user', !S.verifyVideo(meta.id, 'u2', tok, now))
  check('...not for another capture', !S.verifyVideo('00000000-0000-4000-8000-000000000000', 'u1', tok, now))
  check('...not once expired', !S.verifyVideo(meta.id, 'u1', tok, now + (S.VIDEO_TOKEN_TTL_S + 5) * 1000))
  check('...and not when tampered with', !S.verifyVideo(meta.id, 'u1', tok.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), now))
  check('the link lifetime is minutes, not hours', S.VIDEO_TOKEN_TTL_S <= 600)
  const savedSecret = process.env.SWING_POC_SIGNING_SECRET
  process.env.SWING_POC_SIGNING_SECRET = 'short'
  check('a weak signing secret is refused rather than used', (await throws(() => S.signVideo(meta.id, 'u1'), /SIGNING_SECRET/)) === null)
  process.env.SWING_POC_SIGNING_SECRET = savedSecret

  await S.deleteCapture(meta.id)
  check('deleting a capture removes the video and its queue entry', !existsSync(S.captureDir(meta.id)) && !existsSync(q))

  // ── the routes ────────────────────────────────────────────────────────────
  const root = 'app/api/swing-poc'
  const files: string[] = []
  const walk = (d: string) => readdirSync(d).forEach(n => { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p) : n === 'route.ts' && files.push(p) })
  walk(root)
  check('six POC route files', files.length === 6, files.join(', '))
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const handlers = (src.match(/export async function (GET|POST|PATCH|DELETE)/g) || []).length
    check(`${f}: every handler is behind the flag and a session`,
      (src.match(/const off = notEnabled\(\)/g) || []).length === handlers && (src.match(/await requireSession\(\)/g) || []).length === handlers)
    check(`${f}: never writes player measurements, priorities or plans`,
      !/from\(['"](player_metrics|prescriptions|player_pathway_progress|player_pathway_events|practice_plans)['"]\)/.test(src))
    check(`${f}: takes team and player from the stored capture, or authorizes them`,
      /authorizeCapture\(|authorizePlayer\(/.test(src))
  }
  const drillsRoute = readFileSync(`${root}/captures/[id]/drills/route.ts`, 'utf8')
  check('drill links come from the library row (watchUrl), not built by the route',
    /watchUrl\(d as any\)/.test(drillsRoute) && !/youtube\.com|youtu\.be/.test(drillsRoute))
  check('drill retrieval is given the diagnosis, so no model call is made', /retrieveDrills\(\{[^}]*diagnosis/.test(drillsRoute))
  check('"add to plan" is a proposal that says it wrote nothing', /written: false/.test(drillsRoute))
  const ui = readFileSync('components/swingPoc/SwingPocWorkspace.tsx', 'utf8') + readFileSync('components/swingPoc/Pose3DViewer.tsx', 'utf8')
  check('the 3D view is labelled as an estimate on the canvas', ui.includes('Estimated 3D pose — a single-camera model estimate, not measured 3D'))
  check('the UI shows no score or rating', !/\b(score|rating)\b/i.test(ui.replace(/how good the swing is/g, '')))

  console.log('')
  if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
  console.log('ALL PASS')
}

main().catch(e => { console.error(e); process.exit(1) })
