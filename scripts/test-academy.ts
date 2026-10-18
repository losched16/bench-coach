// BenchCoach Academy — parser, seed, fulfilment, webhook routing and route rules.
//
//   npm run test:academy
//   ACADEMY_MANUSCRIPT=~/private/course.md npm run test:academy   # + the real manuscript
//
// No network, no database: payments run against a fake Stripe and the strict
// in-memory Supabase (unique keys enforced). Database row-level security is
// proved separately in Postgres by `npm run test:migration-080`.

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { parseManuscript, blockSource, type Block } from '../lib/academy/manuscript'
import { seedSql } from '../lib/academy/seed'
import { COURSES, courseCopy, isCourseSlug, isLessonKey } from '../lib/academy/catalog'
import { fulfillCheckoutSession, handleRefund } from '../lib/academy/fulfillment'
import { handleAcademyEvent } from '../lib/academy/webhook'
import { safeRedirect, isAcademyPath } from '../lib/safeRedirect'
import { testApiTarget } from '../lib/stripe'
import { StrictSupabase } from './lib/strictSupabase'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

const allText = (blocks: Block[]) => JSON.stringify(blocks)

function parserChecks(md: string, label: string) {
  const c = parseManuscript(md, { slug: 'build-a-better-baseball-swing', previewLessonKey: '1-1' })
  const blocks = c.lessons.flatMap(l => l.blocks)
  const nonHeading = blocks.filter(b => b.type !== 'h')
  const mismatched = nonHeading.filter(b => !md.includes(blockSource(b)))
  check(`${label}: every block reassembles to its manuscript paragraph, word for word`, mismatched.length === 0, `${mismatched.length}/${nonHeading.length}`)
  check(`${label}: no "Video to curate" producer brief in learner content`, !/Video to curate/.test(allText(blocks)))
  check(`${label}: Parts X–XIII never reach learner content`, !/Approval checklist for each link|Draft Claude Code implementation brief|INTERNAL EDITORIAL|SECRET-PART|WIN Reality reference/.test(allText(blocks) + c.lessons.map(l => l.fieldTest).join('')))
  check(`${label}: exactly one free-preview lesson, 1.1`, c.lessons.filter(l => l.isPreview).map(l => l.key).join() === '1-1')
  check(`${label}: every lesson belongs to a module and has a number`, c.lessons.filter(l => l.kind === 'lesson').every(l => l.moduleKey && /^\d+\.\d+$/.test(l.numberLabel || '')))
  check(`${label}: keys are URL-safe and unique`, new Set(c.lessons.map(l => l.key)).size === c.lessons.length && c.lessons.every(l => isLessonKey(l.key)))
  return c
}

async function main() {
  // ── parser: synthetic fixture (always) ───────────────────────────────────
  const sample = readFileSync('scripts/fixtures/academy-sample-manuscript.md', 'utf8')
  const s = parserChecks(sample, 'sample')
  check('sample: 2 modules, 3 lessons, 3 intro pages, 3 resources',
    s.modules.length === 2 && s.lessons.filter(l => l.kind === 'lesson').length === 3 &&
    s.lessons.filter(l => l.kind === 'intro').length === 3 && s.lessons.filter(l => l.kind === 'resource').length === 3,
    s.lessons.map(l => `${l.kind}:${l.key}`).join(' '))
  check('sample: module titles are title-cased, words unchanged', s.modules[0].title === 'The Sample Foundation' && s.modules[0].subtitle === 'Sample subtitle one')
  check('sample: module outcome captured', s.modules[0].outcome === 'The sample player can do the sample thing.')
  const l11 = s.lessons.find(l => l.key === '1-1')!
  const drill = l11.blocks.find(b => b.type === 'drill') as Extract<Block, { type: 'drill' }>
  check('a drill keeps its name, equipment and success line', drill?.name === 'Sample drill one' && drill.equipment === 'tee, bat' && drill.success === 'Sample success.')
  const look = l11.blocks.find(b => b.type === 'look_for') as Extract<Block, { type: 'look_for' }>
  check('"Look for" splits into mistake → response pairs, keeping each label',
    look?.mistakes.length === 2 && look.mistakes[0].responseLabel === 'Coach response' && look.mistakes[1].response === 'Sample response two.')
  check('the producer brief is kept apart for editors', l11.videoBrief?.includes('SECRET-PRODUCER-BRIEF-1') === true)
  check('a module field test goes on the module\'s last lesson', s.lessons.find(l => l.key === '1-2')?.fieldTest === 'Sample field test text.' && !l11.fieldTest)
  check('the course-wide safety paragraph is found', s.safetyText === 'Sample safety text: supervise every swing and keep bystanders clear.')
  check('the troubleshooting table is a resource with its rows', (s.lessons.find(l => l.key === 'troubleshooting')?.blocks.find(b => b.type === 'table') as any)?.rows?.length === 1)
  const flags = s.flags.map(f => `${f.lessonKey}:${f.flag}`)
  check('editorial flags: missing video brief, missing ready-to-move-on, no approved video',
    flags.includes('1-2:missing_video_brief') && flags.includes('2-1:missing_ready') && flags.includes('1-1:video_not_approved'), flags.join(' '))
  check('editorial flags: a module without a field test is flagged', flags.some(f => f.endsWith(':missing_field_test')))

  // ── parser: the real manuscript (when provided) ─────────────────────────
  const real = process.env.ACADEMY_MANUSCRIPT
  if (real && existsSync(real)) {
    const c = parserChecks(readFileSync(real, 'utf8'), 'manuscript')
    const lessons = c.lessons.filter(l => l.kind === 'lesson')
    check('manuscript: 6 modules and 19 lessons', c.modules.length === 6 && lessons.length === 19, `${c.modules.length}/${lessons.length}`)
    check('manuscript: 3–4 lessons per module', c.modules.every(m => [3, 4].includes(lessons.filter(l => l.moduleKey === m.key).length)))
    check('manuscript: every lesson has 2 drills, a cue and a coach\'s corner', lessons.every(l =>
      l.blocks.filter(b => b.type === 'drill').length === 2 &&
      l.blocks.some(b => b.type === 'labeled' && b.kind === 'cue') && l.blocks.some(b => b.type === 'labeled' && b.kind === 'coach_corner')))
    check('manuscript: four-week program, session card and troubleshooting are resources',
      ['four-week-program', 'session-card', 'troubleshooting'].every(k => c.lessons.find(l => l.key === k)?.kind === 'resource'))
    check('manuscript: lessons 3.3 and 5.3 are flagged for missing video briefs',
      c.flags.some(f => f.lessonKey === '3-3' && f.flag === 'missing_video_brief') && c.flags.some(f => f.lessonKey === '5-3' && f.flag === 'missing_video_brief'))
  } else {
    console.log('skip manuscript checks (set ACADEMY_MANUSCRIPT to the private manuscript to run them)')
  }

  // ── seed SQL ─────────────────────────────────────────────────────────────
  const copy = courseCopy('build-a-better-baseball-swing')!
  const sql = seedSql(s, copy)
  const courseUpsert = sql.slice(sql.indexOf('INSERT INTO public.academy_courses'), sql.indexOf(';', sql.indexOf('INSERT INTO public.academy_courses')))
  check('seed: a new course starts as draft (no status written)', !/status/.test(courseUpsert.split('ON CONFLICT')[0]))
  check('seed: re-import never touches status, price or Stripe price', !/status|price_cents|stripe_price_id/.test(courseUpsert.split('ON CONFLICT')[1] || ''))
  check('seed: retired lessons become draft, never deleted', /SET status = 'draft'/.test(sql) && !/DELETE FROM public\.academy_lessons/.test(sql))
  check('seed: quotes are escaped', /Sample cue\./.test(sql) && !/[^']'Sample cue/.test(sql))
  check('seed: is one transaction', sql.trim().startsWith('--') && /\nBEGIN;/.test(sql) && /\nCOMMIT;/.test(sql))

  // ── catalog ──────────────────────────────────────────────────────────────
  check('catalog: every course slug is valid', COURSES.every(c => isCourseSlug(c.slug)))
  // notPromised is the manuscript's own list of things NOT promised ("Guaranteed velocity…").
  check('catalog: no invented price, refund or guarantee in public copy', !COURSES.some(({ notPromised: _n, ...c }) => /\$\d|refund|guarantee|money.back/i.test(JSON.stringify(c))))
  check('catalog: slug validation refuses traversal', !isCourseSlug('../x') && !isCourseSlug('A') && !isLessonKey('a/b') && !isLessonKey(''))

  // ── fulfilment ───────────────────────────────────────────────────────────
  const USER = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-8222-222222222222'
  const COURSE = 'aaaaaaaa-0000-4000-8000-000000000001'
  const PRICE = 'price_course_1900'
  const mkDb = () => {
    const db = new StrictSupabase({
      academy_courses: [{ id: COURSE, slug: 'build-a-better-baseball-swing', stripe_price_id: PRICE, currency: 'usd', status: 'published' }],
      academy_enrollments: [], academy_stripe_events: [],
      coaches: [{ id: 'coach-1', user_id: USER, is_subscribed: false, subscription_tier: 'free' }],
    }, { uniques: { academy_enrollments: [['user_id', 'course_id'], ['stripe_checkout_session_id']], academy_stripe_events: [['event_id']] } }) as any
    db.auth.admin = { getUserById: async (id: string) => ([USER, OTHER].includes(id) ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'User not found' } }) }
    return db
  }
  const stripe = (price = PRICE) => ({ checkout: { sessions: { listLineItems: async () => ({ data: [{ price: { id: price } }] }) } } }) as any
  const session = (over: any = {}) => ({
    id: 'cs_test_1', mode: 'payment', payment_status: 'paid', client_reference_id: USER, currency: 'usd', amount_total: 1900,
    payment_intent: 'pi_1', customer: null, metadata: { kind: 'academy_course', course_id: COURSE, user_id: USER, course_slug: 'x' }, ...over,
  }) as any

  let db = mkDb()
  let r = await fulfillCheckoutSession(db, stripe(), session())
  check('a paid course checkout enrolls the buyer', r.outcome === 'enrolled' && db.tables.academy_enrollments.length === 1 && db.tables.academy_enrollments[0].status === 'active')
  check('...and records how it was paid', db.tables.academy_enrollments[0].stripe_payment_intent_id === 'pi_1' && db.tables.academy_enrollments[0].source === 'purchase')
  check('a course purchase NEVER touches the coach subscription', db.tables.coaches[0].is_subscribed === false && db.tables.coaches[0].subscription_tier === 'free' && db.queriesOn('coaches').length === 0)
  r = await fulfillCheckoutSession(db, stripe(), session())
  check('the same session again (webhook replay or confirm) is a no-op', r.outcome === 'already_enrolled' && db.tables.academy_enrollments.length === 1)
  r = await fulfillCheckoutSession(db, stripe(), session({ id: 'cs_test_2', payment_intent: 'pi_2' }))
  check('a second purchase of an owned course changes nothing (flagged for refund)', r.outcome === 'duplicate_purchase' && db.tables.academy_enrollments.length === 1 && db.tables.academy_enrollments[0].stripe_checkout_session_id === 'cs_test_1')

  db = mkDb()
  check('an unpaid session grants nothing', (await fulfillCheckoutSession(db, stripe(), session({ payment_status: 'unpaid' }))).outcome === 'not_paid' && db.tables.academy_enrollments.length === 0)
  check('a different price grants nothing', (await fulfillCheckoutSession(db, stripe('price_other'), session())).outcome === 'rejected' && db.tables.academy_enrollments.length === 0)
  check('a different currency grants nothing', (await fulfillCheckoutSession(db, stripe(), session({ currency: 'eur' }))).outcome === 'rejected')
  check('buyer id must match between reference and metadata', (await fulfillCheckoutSession(db, stripe(), session({ client_reference_id: OTHER }))).outcome === 'rejected')
  check('an unknown buyer account grants nothing', (await fulfillCheckoutSession(db, stripe(), session({ client_reference_id: '33333333-3333-4333-8333-333333333333', metadata: { kind: 'academy_course', course_id: COURSE, user_id: '33333333-3333-4333-8333-333333333333' } }))).outcome === 'rejected')
  check('a subscription checkout is never an Academy purchase', (await fulfillCheckoutSession(db, stripe(), session({ mode: 'subscription' }))).outcome === 'rejected')
  check('a session without the Academy marker is not ours', (await fulfillCheckoutSession(db, stripe(), session({ metadata: { user_id: USER } }))).outcome === 'not_academy')
  check('an unknown course grants nothing', (await fulfillCheckoutSession(db, stripe(), session({ metadata: { kind: 'academy_course', course_id: 'aaaaaaaa-0000-4000-8000-000000000999', user_id: USER } }))).outcome === 'rejected')
  check('no rejected attempt left a row behind', db.tables.academy_enrollments.length === 0)

  // A concurrent delivery inserted the row after our lookup: the unique key
  // on the checkout session stops a second row, and that counts as success.
  db = mkDb()
  db.tables.academy_enrollments.push({ id: 'raced', user_id: OTHER, course_id: COURSE, status: 'active', stripe_checkout_session_id: 'cs_test_1' })
  r = await fulfillCheckoutSession(db, stripe(), session())
  check('two simultaneous deliveries of one payment enroll once', r.outcome === 'already_enrolled' && db.tables.academy_enrollments.length === 1, r.outcome)

  // Refunds.
  db = mkDb()
  await fulfillCheckoutSession(db, stripe(), session())
  r = await handleRefund(db, { payment_intent: 'pi_1', refunded: false } as any)
  check('a partial refund leaves access alone', r.outcome === 'rejected' && db.tables.academy_enrollments[0].status === 'active')
  r = await handleRefund(db, { payment_intent: 'pi_1', refunded: true } as any)
  check('a full refund ends access', r.outcome === 'revoked' && db.tables.academy_enrollments[0].status === 'refunded' && !!db.tables.academy_enrollments[0].revoked_at)
  check('a refund for something that is not a course is ignored', (await handleRefund(db, { payment_intent: 'pi_subscription', refunded: true } as any)).outcome === 'not_academy')
  r = await fulfillCheckoutSession(db, stripe(), session({ id: 'cs_test_3', payment_intent: 'pi_3' }))
  check('buying again after a refund reactivates the same enrollment', r.outcome === 'reactivated' && db.tables.academy_enrollments.length === 1 && db.tables.academy_enrollments[0].status === 'active' && db.tables.academy_enrollments[0].revoked_at === null)

  // ── webhook routing and replay ──────────────────────────────────────────
  db = mkDb()
  const ev = (id: string, type: string, object: any) => ({ id, type, data: { object } }) as any
  let w = await handleAcademyEvent(db, stripe(), ev('evt_1', 'checkout.session.completed', session()))
  check('webhook: an Academy checkout is handled here', w.handled && w.outcome === 'enrolled')
  w = await handleAcademyEvent(db, stripe(), ev('evt_1', 'checkout.session.completed', session()))
  check('webhook: the same event replayed is skipped', w.handled && w.replay === true && db.tables.academy_enrollments.length === 1)
  check('webhook: each event is recorded once', db.tables.academy_stripe_events.length === 1)
  w = await handleAcademyEvent(db, stripe(), ev('evt_2', 'checkout.session.completed', { ...session(), mode: 'subscription', metadata: { user_id: USER, tier: 'coach' } }))
  check('webhook: a subscription checkout falls through to the subscription code', w.handled === false)
  w = await handleAcademyEvent(db, stripe(), ev('evt_3', 'checkout.session.async_payment_failed', session({ id: 'cs_x' })))
  check('webhook: a failed delayed payment is recorded, grants nothing', w.handled && w.outcome === 'payment_failed' && db.tables.academy_enrollments.length === 1)
  w = await handleAcademyEvent(db, stripe(), ev('evt_4', 'invoice.payment_failed', {}))
  check('webhook: subscription events are not touched', w.handled === false)
  w = await handleAcademyEvent(db, stripe(), ev('evt_5', 'charge.refunded', { payment_intent: 'pi_1', refunded: true }))
  check('webhook: a full refund of a course ends access', w.handled && w.outcome === 'revoked' && db.tables.academy_enrollments[0].status === 'refunded')
  const failingDb = mkDb(); failingDb.failing.add('academy_enrollments')
  let threw = false
  try { await handleAcademyEvent(failingDb, stripe(), ev('evt_6', 'checkout.session.completed', session())) } catch { threw = true }
  check('webhook: a database failure throws (Stripe retries) and records nothing', threw && failingDb.tables.academy_stripe_events.length === 0)

  const route = readFileSync('app/api/stripe/webhook/route.ts', 'utf8')
  check('webhook route: verifies the signature before anything else', route.indexOf('constructEvent') < route.indexOf('handleAcademyEvent(supabaseAdmin'))
  check('webhook route: Academy runs before the subscription switch', route.indexOf('handleAcademyEvent(supabaseAdmin') < route.indexOf('switch (event.type)'))
  check('webhook route: only subscription-mode checkouts can change a coach plan', /session\.mode !== 'subscription'[\s\S]{0,200}break/.test(route))

  // ── redirects and the Stripe test switch ────────────────────────────────
  check('redirect: same-site paths pass', safeRedirect('/learn/x?a=1') === '/learn/x?a=1' && safeRedirect('/academy/x?buy=1', '/d') === '/academy/x?buy=1')
  check('redirect: off-site and tricks are refused', ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/x\nSet-Cookie:a', ''].every(u => safeRedirect(u, '/dashboard') === '/dashboard'))
  check('redirect: academy paths recognised', isAcademyPath('/learn/x') && isAcademyPath('/academy') && !isAcademyPath('/dashboard') && !isAcademyPath('/learning'))
  check('stripe test target: loopback only, never a live key, never Vercel production',
    testApiTarget('sk_test_x', { STRIPE_API_BASE: 'http://127.0.0.1:12111' }).port === 12111 &&
    !testApiTarget('sk_live_x', { STRIPE_API_BASE: 'http://127.0.0.1:12111' }).host &&
    !testApiTarget('sk_test_x', { STRIPE_API_BASE: 'http://127.0.0.1:12111', VERCEL_ENV: 'production' }).host &&
    !testApiTarget('sk_test_x', { STRIPE_API_BASE: 'http://evil.example:80' }).host)

  // ── route rules (static) ────────────────────────────────────────────────
  const files: string[] = []
  const walk = (d: string) => readdirSync(d).forEach(n => { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p) })
  walk('app/api/academy'); walk('app/academy'); walk('app/learn'); walk('lib/academy'); walk('components/academy')
  for (const f of files.filter(f => f.startsWith('app/api/academy') && f.endsWith('route.ts'))) {
    const src = readFileSync(f, 'utf8')
    check(`${f}: decides the caller from the session, never from the body`, /currentUser\(\)|requireAdmin\(\)/.test(src) && !/\b(userId|user_id)\s*[,}]\s*=\s*await request\.json/.test(src) && !/body\??\.user_?[iI]d/.test(src))
  }
  const academySrc = files.filter(f => /\.(ts|tsx)$/.test(f)).map(f => [f, readFileSync(f, 'utf8')] as const)
  check('no Academy code writes to coaches', !academySrc.some(([, src]) => /from\('coaches'\)\s*\.(update|insert|upsert|delete)/.test(src)))
  check('no Academy code embeds video players or iframes', !academySrc.some(([, src]) => /<iframe|youtube\.com\/embed/.test(src)))
  // server.ts reads it (guarded); seed.ts only WRITES it for the offline import.
  check('lesson text is only read through the guarded helpers', academySrc.filter(([, src]) => /academy_lesson_bodies/.test(src)).every(([f]) => /lib\/academy\/(server|seed)\.ts$/.test(f)))
  check('...and the import writer never reads it back', !/from\('academy_lesson_bodies'\)/.test(readFileSync('lib/academy/seed.ts', 'utf8')))
  const pub = academySrc.filter(([f]) => f.startsWith('app/academy'))
  check('public pages read lesson text only for the preview lesson', pub.filter(([, src]) => /getLessonBody/.test(src)).every(([f, src]) => /preview/.test(f) && /is_preview/.test(src)))
  check('no fabricated "approved" video status anywhere in code', !academySrc.some(([, src]) => /approval_status:\s*'approved'/.test(src)))

  console.log('')
  if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
  console.log('ALL PASS')
}

main().catch(e => { console.error(e); process.exit(1) })
