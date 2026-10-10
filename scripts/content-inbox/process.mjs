import Anthropic from '@anthropic-ai/sdk'

const NOTION_VERSION = '2026-03-11'
const DATA_SOURCE_ID = process.env.CONTENT_INBOX_DATA_SOURCE_ID || 'e258f911-ddb4-43dd-9e83-6e05b3261dac'
const APIFY_ACTOR = process.env.CONTENT_INBOX_APIFY_ACTOR || 'fguiraud~instagram-reels-transcript-scraper'
const MODEL = process.env.CONTENT_INBOX_MODEL || 'claude-sonnet-5'
const BATCH_SIZE = Math.max(1, Math.min(10, Number(process.env.CONTENT_INBOX_BATCH_SIZE || 3)))
const RETRY_ERRORS = process.argv.includes('--retry-errors')
const DRY_RUN = process.argv.includes('--dry-run')

const VALID_SKILLS = new Set([
  'Hitting', 'Fielding', 'Throwing', 'Pitching', 'Catching',
  'Baserunning', 'Practice Planning', 'Mental Game', 'Speed & Agility',
])
const VALID_CONTENT_JOBS = new Set(['Reach', 'Authority', 'Trust', 'Conversion'])
const VALID_FORMATS = new Set([
  'Reaction / Remix', 'Drill Breakdown', 'Carousel', 'Tutorial',
  'Coach POV', 'Build in Public', 'Other',
])

function need(name) {
  const value = process.env[name]
  if (!value) throw new Error(name + ' is required')
  return value
}

const NOTION_TOKEN = need('NOTION_CONTENT_TOKEN')
const APIFY_TOKEN = need('APIFY_TOKEN')
const anthropic = new Anthropic({ apiKey: need('ANTHROPIC_API_KEY'), maxRetries: 4 })

function cleanInstagramUrl(raw) {
  try {
    const u = new URL(raw)
    if (!/(^|\\.)instagram\\.com$/i.test(u.hostname)) return raw
    return u.origin + u.pathname
  } catch {
    return raw
  }
}

function cap(value, max) {
  return String(value || '').slice(0, max)
}

function chunks(value, size = 1900) {
  const s = String(value || '')
  const out = []
  for (let i = 0; i < s.length && out.length < 100; i += size) out.push(s.slice(i, i + size))
  return out
}

function richText(value) {
  return { rich_text: chunks(value).map(content => ({ type: 'text', text: { content } })) }
}

function plain(prop) {
  if (!prop) return ''
  if (prop.type === 'title') return (prop.title || []).map(x => x.plain_text || x.text?.content || '').join('')
  if (prop.type === 'rich_text') return (prop.rich_text || []).map(x => x.plain_text || x.text?.content || '').join('')
  if (prop.type === 'url') return prop.url || ''
  if (prop.type === 'select') return prop.select?.name || ''
  return ''
}

function select(name) {
  return { select: name ? { name } : null }
}

function multiSelect(names) {
  return { multi_select: names.map(name => ({ name })) }
}

function url(value) {
  return { url: value || null }
}

async function notion(path, init = {}) {
  const res = await fetch('https://api.notion.com/v1' + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + NOTION_TOKEN,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  if (!res.ok) {
    const body = cap(await res.text().catch(() => ''), 1200)
    throw new Error('Notion ' + res.status + ': ' + (body || res.statusText))
  }
  return res.json()
}

async function queryInbox() {
  const data = await notion('/data_sources/' + DATA_SOURCE_ID + '/query', {
    method: 'POST',
    body: JSON.stringify({
      filter: { property: 'Status', select: { equals: 'Inbox' } },
      sorts: [{ property: 'Date Added', direction: 'ascending' }],
      page_size: 25,
    }),
  })
  return (data.results || []).filter(page => {
    const state = plain(page.properties?.['Automation State'])
    if (state === 'Ready' || state === 'Processing') return false
    if (state === 'Error' && !RETRY_ERRORS) return false
    return Boolean(plain(page.properties?.['Source URL']))
  }).slice(0, BATCH_SIZE)
}

async function updatePage(pageId, properties) {
  if (DRY_RUN) {
    console.log('[dry-run] update ' + pageId + ': ' + Object.keys(properties).join(', '))
    return
  }
  await notion('/pages/' + pageId, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  })
}

function firstNonEmpty(obj, names) {
  for (const name of names) {
    const v = obj?.[name]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

function normalizeApify(items, sourceUrl) {
  const item = Array.isArray(items) ? (items.find(x => x?.status === 'ok') || items[0]) : items
  if (!item || item.status === 'error') {
    throw new Error('Apify transcription failed: ' + (item?.error || item?.message || 'no successful item'))
  }
  const video = item.video || {}
  const creator = firstNonEmpty(video, ['author', 'username', 'ownerUsername', 'owner_username'])
    || firstNonEmpty(item, ['author', 'username', 'ownerUsername', 'owner_username'])
  return {
    sourceUrl,
    creator: creator ? String(creator).replace(/^@/, '') : '',
    transcript: String(firstNonEmpty(item, ['text', 'transcript', 'transcription', 'audioTranscript']) || '').trim(),
    caption: String(firstNonEmpty(item, ['caption', 'description', 'postCaption'])
      || firstNonEmpty(video, ['caption', 'description']) || '').trim(),
    mediaUrl: String(firstNonEmpty(item, ['videoUrl', 'downloadedVideo', 'mediaUrl'])
      || firstNonEmpty(video, ['url', 'videoUrl', 'mediaUrl']) || '').trim(),
  }
}

async function transcribeInstagram(sourceUrl) {
  const endpoint = 'https://api.apify.com/v2/acts/' + APIFY_ACTOR
    + '/run-sync-get-dataset-items?token=' + encodeURIComponent(APIFY_TOKEN)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sources: [{ url: cleanInstagramUrl(sourceUrl) }],
      model: process.env.CONTENT_INBOX_WHISPER_MODEL || 'base',
      language: 'auto',
      task: 'transcribe',
      outputs: ['text'],
    }),
  })
  if (!res.ok) {
    const body = cap(await res.text().catch(() => ''), 1200)
    throw new Error('Apify ' + res.status + ': ' + (body || res.statusText))
  }
  return normalizeApify(await res.json(), sourceUrl)
}

function safeArray(value) {
  return Array.isArray(value) ? value.map(x => String(x).trim()).filter(Boolean) : []
}

function normalizeEditorial(raw) {
  const hooks = safeArray(raw.hook_candidates).slice(0, 5)
  return {
    summary: String(raw.summary || '').trim(),
    contentJob: VALID_CONTENT_JOBS.has(raw.content_job) ? raw.content_job : 'Authority',
    skills: safeArray(raw.skills).filter(x => VALID_SKILLS.has(x)),
    drillConcept: String(raw.drill_concept || '').trim(),
    problem: String(raw.problem_it_solves || '').trim(),
    benchCoachAngle: String(raw.benchcoach_angle || '').trim(),
    format: VALID_FORMATS.has(raw.format) ? raw.format : 'Reaction / Remix',
    hooks,
    selectedHook: String(raw.selected_hook || hooks[0] || '').trim(),
    scriptDraft: String(raw.script_draft || '').trim(),
    cta: String(raw.cta || '').trim(),
  }
}

async function buildEditorial(page, source) {
  const p = page.properties || {}
  const title = plain(p.Content)
  const clintTake = plain(p['Clint Take'])
  const quickNote = plain(p['Quick Note'])
  const ages = (p['Age Group']?.multi_select || []).map(x => x.name)

  const evidenceParts = []
  if (source.caption) evidenceParts.push('SOURCE CAPTION:\n' + cap(source.caption, 6000))
  if (source.transcript) evidenceParts.push('TRANSCRIPT (automatic speech recognition; may contain errors):\n' + cap(source.transcript, 14000))
  if (clintTake) evidenceParts.push("CLINT'S NOTE/TAKE:\n" + cap(clintTake, 3000))
  if (quickNote) evidenceParts.push('QUICK NOTE:\n' + cap(quickNote, 3000))
  if (!evidenceParts.length && !title) return null

  const creator = source.creator ? '@' + source.creator : 'the original creator'
  const prompt = [
    'You are the editorial analyst for BenchCoach, a youth-baseball coaching app for volunteer parent-coaches.',
    '',
    'Turn the source below into ONE strong content opportunity for Clint to review. This is curation and commentary, not copying.',
    '',
    'Rules:',
    '- Ground every factual claim about the source in the caption/transcript or Clint explicit note.',
    '- The transcript is ASR and can be wrong. Do NOT claim you visually observed body position, equipment, mechanics, or drill setup unless Clint explicitly said it.',
    '- Never call this visually verified. This workflow is transcript/metadata only.',
    '- One Reel may contain multiple drills or ideas. Pick the primary concept for this post; note multi-concept sources in the summary.',
    '- Transform the source. Do not reproduce the transcript and do not quote more than a short phrase.',
    '- Credit ' + creator + ' naturally when creator data is available.',
    '- Audience: volunteer youth baseball coaches, especially 6U-12U.',
    '- BenchCoach claims may reference only shipped capabilities: curated drill library, practice planning, player observations, player development plans/pathways, development reports, and coach-controlled AI assistance.',
    '- Do not invent features, metrics, customers, outcomes, or testimonials.',
    '- Product connection should explain how a coach goes from a teaching point/drill to diagnosing a player problem, choosing a progression, putting it into practice/development work, and tracking improvement.',
    '- Respect the age groups Clint already selected; do not invent narrower ages.',
    '- Generate at least 3 genuinely different hooks.',
    '- Default to Reaction / Remix unless another allowed format is clearly better.',
    '- Script should be about 35-60 seconds of Clint commentary around short source clips.',
    '- Structure: hook -> source/credit -> Clint coaching insight -> when/why to use -> BenchCoach connection -> CTA.',
    '- CTA should be soft unless Conversion is clearly the right content job.',
    '',
    'Allowed content_job: Reach, Authority, Trust, Conversion.',
    'Allowed skills: ' + Array.from(VALID_SKILLS).join(', ') + '.',
    'Allowed format: ' + Array.from(VALID_FORMATS).join(', ') + '.',
    '',
    'Return JSON only with exactly these keys:',
    '{"summary":"...","content_job":"Authority","skills":["Hitting"],"drill_concept":"...","problem_it_solves":"...","benchcoach_angle":"...","format":"Reaction / Remix","hook_candidates":["...","...","..."],"selected_hook":"...","script_draft":"...","cta":"..."}',
    '',
    'CONTENT INBOX TITLE: ' + (title || '(untitled)'),
    'AGE GROUPS ALREADY CHOSEN BY CLINT: ' + (ages.length ? ages.join(', ') : '(none specified)'),
    'SOURCE CREATOR: ' + (source.creator ? '@' + source.creator : '(unknown)'),
    'SOURCE URL: ' + source.sourceUrl,
    '',
    ...evidenceParts,
  ].join('\n')

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1800,
    temperature: 0.35,
    messages: [{ role: 'user', content: prompt }],
  })
  let text = (response.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim()
  text = text.replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '').trim()
  try {
    return normalizeEditorial(JSON.parse(text))
  } catch {
    throw new Error('Editorial model returned invalid JSON: ' + cap(text, 500))
  }
}

async function processPage(page) {
  const p = page.properties || {}
  const pageId = page.id
  const sourceUrl = plain(p['Source URL'])
  console.log('\nProcessing: ' + (plain(p.Content) || sourceUrl))

  await updatePage(pageId, {
    'Automation State': select('Processing'),
    'Processing Error': richText(''),
  })

  try {
    const source = await transcribeInstagram(sourceUrl)
    const editorial = await buildEditorial(page, source)
    const hasTranscript = Boolean(source.transcript)

    if (!editorial) {
      await updatePage(pageId, {
        Platform: select('Instagram'),
        Creator: richText(source.creator),
        'Source Caption': richText(source.caption),
        Transcript: richText(source.transcript),
        'Transcript Source': select(hasTranscript ? 'Apify Whisper' : 'Unavailable'),
        'Media URL': url(source.mediaUrl),
        'Evidence Basis': select(hasTranscript ? 'Transcript + Metadata' : 'Manual Note Only'),
        'Automation State': select('Manual Review'),
        'Processing Error': richText('No usable transcript, caption, title, or manual note was available for editorial analysis.'),
      })
      return
    }

    await updatePage(pageId, {
      Platform: select('Instagram'),
      Creator: richText(source.creator),
      'Source Caption': richText(source.caption),
      Transcript: richText(source.transcript),
      'Transcript Source': select(hasTranscript ? 'Apify Whisper' : 'Unavailable'),
      'Media URL': url(source.mediaUrl),
      'Evidence Basis': select(hasTranscript ? 'Transcript + Metadata' : 'Manual Note Only'),
      'AI Summary': richText(editorial.summary),
      'Drill / Concept': richText(editorial.drillConcept),
      'Problem It Solves': richText(editorial.problem),
      Skill: multiSelect(editorial.skills),
      'BenchCoach Angle': richText(editorial.benchCoachAngle),
      'Content Job': select(editorial.contentJob),
      'Hook Candidates': richText(editorial.hooks.map((h, i) => String(i + 1) + '. ' + h).join('\n')),
      Hook: richText(editorial.selectedHook),
      'Script Draft': richText(editorial.scriptDraft),
      CTA: richText(editorial.cta),
      Format: select(editorial.format),
      Status: select('Reviewed'),
      'Automation State': select(hasTranscript ? 'Ready' : 'Manual Review'),
      'Processing Error': richText(hasTranscript ? '' : 'Drafted without a source transcript; review against the Reel before production.'),
    })
    console.log('  -> ' + (hasTranscript ? 'ready from transcript + metadata' : 'manual review required'))
  } catch (error) {
    const message = cap(error?.message || error, 1800)
    console.error('  -> error: ' + message)
    await updatePage(pageId, {
      'Automation State': select('Error'),
      'Processing Error': richText(message),
    })
  }
}

async function main() {
  const pages = await queryInbox()
  if (!pages.length) {
    console.log('No eligible Content Inbox items found.')
    return
  }
  console.log('Found ' + pages.length + ' eligible Content Inbox item(s).')
  for (const page of pages) await processPage(page)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
