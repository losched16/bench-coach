// Does a copied scouting report survive the paste into a document?
//
// The failure is not an exception, it is a coach pasting into a team doc and
// getting literal ** and ## in front of the other coaches — or getting a wall
// of undifferentiated text because only text/plain made it onto the clipboard.
//
// The block rules here mirror components/AnalysisProse.tsx on purpose. If the
// two drift, the paste stops looking like the screen, which is the one thing
// this has to get right.
//
//   npm run test:report-copy

import { bodyToHtml, reportToHtml, reportToPlainText } from '@/lib/analysis'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`) }
}

// ── blocks ──────────────────────────────────────────────────────────────────

check('a paragraph becomes a p', bodyToHtml('They put the ball in play.') === '<p>They put the ball in play.</p>')
check('wrapped lines join into one paragraph',
  bodyToHtml('They put the ball\nin play.') === '<p>They put the ball in play.</p>',
  bodyToHtml('They put the ball\nin play.'))
check('a blank line starts a new paragraph',
  bodyToHtml('One.\n\nTwo.') === '<p>One.</p><p>Two.</p>')

check('bullets become a real list',
  bodyToHtml('- first\n- second') === '<ul><li>first</li><li>second</li></ul>',
  bodyToHtml('- first\n- second'))
check('asterisk bullets work too', bodyToHtml('* one') === '<ul><li>one</li></ul>')
check('numbered items become an ol',
  bodyToHtml('1. first\n2. second') === '<ol><li>first</li><li>second</li></ol>')
check('a list ends cleanly before a paragraph',
  bodyToHtml('- one\n\nAfter.') === '<ul><li>one</li></ul><p>After.</p>',
  bodyToHtml('- one\n\nAfter.'))
check('an empty body produces nothing', bodyToHtml('') === '')

// ── inline ──────────────────────────────────────────────────────────────────

check('bold becomes strong', bodyToHtml('**Gio C** is their guy.') === '<p><strong>Gio C</strong> is their guy.</p>')
check('bold works inside a bullet',
  bodyToHtml('- **#22** throws strikes') === '<ul><li><strong>#22</strong> throws strikes</li></ul>')
check('no literal asterisks survive', !bodyToHtml('**bold**').includes('*'))

// ── injection ───────────────────────────────────────────────────────────────
// The report is model output about names a coach typed. It goes on a clipboard
// and then into somebody's document, so tags must not ride along.

check('angle brackets are escaped',
  bodyToHtml('<script>alert(1)</script>') === '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  bodyToHtml('<script>alert(1)</script>'))
check('ampersands are escaped', bodyToHtml('R & R') === '<p>R &amp; R</p>')
check('a tag in a team name is escaped', reportToHtml('', { title: '<b>Hawks</b>' }).includes('&lt;b&gt;'))

// ── the whole report ────────────────────────────────────────────────────────

const MD = `## How they play
They put the ball in play. **Carson R** is 12/20.

## Their pitching
- Gio C — 75% strikes
- Nash F — 57% strikes`

const html = reportToHtml(MD, {
  title: 'Warrington — Scouting Report',
  subtitle: 'Written 11 Aug 2026 from 6 entries',
  headline: 'Contact team, lean on two arms.',
})

check('the title is an h1', html.startsWith('<h1>Warrington — Scouting Report</h1>'))
check('the provenance line is there', html.includes('Written 11 Aug 2026 from 6 entries'),
  'once this is in a doc it has left the app — a reader needs to know how old it is')
check('the headline is carried', html.includes('Contact team'))
check('sections become h2', html.includes('<h2>How they play</h2>') && html.includes('<h2>Their pitching</h2>'))
check('section bodies are rendered', html.includes('<strong>Carson R</strong>'))
check('the pitching bullets are a list', html.includes('<ul><li>Gio C — 75% strikes</li>'))
check('no class attributes ride along', !html.includes('class='),
  'the destination document should style it, not us')
check("what's changed gets its own heading",
  reportToHtml(MD, { title: 'T', whatsChanged: 'Two new games.' }).includes('changed'))

// ── plain text fallback ─────────────────────────────────────────────────────

const txt = reportToPlainText(MD, { title: 'Warrington', subtitle: '6 entries', headline: 'Contact team.' })
check('plain text keeps the title', txt.startsWith('Warrington'))
check('plain text has no markdown asterisks', !txt.includes('**'))
check('plain text has no hashes', !txt.includes('##'))
check('headings are upper-cased', txt.includes('HOW THEY PLAY'))
check('bullets become real bullet characters', txt.includes('• Gio C'))
check('runs of blank lines are collapsed', !txt.includes('\n\n\n'))

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
