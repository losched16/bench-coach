// The Charlie acceptance scenario, printed.
//
//   npm run acceptance:programs
//
// Runs the real intent classifier, brief parser, generator, validators and
// chat renderer against the Charlie request, FIXTURE player evidence and a
// FIXTURE drill pool. NO live model is called, so this shows the structural
// behaviour (every week, every skill, the gate, the checks) and says nothing
// about how the model's coaching language reads. That needs a real key and a
// real authorised account.

import { classifyIntent } from '@/lib/programs/intent'
import { buildBrief } from '@/lib/programs/brief'
import { generateProgram } from '@/lib/programs/generate'
import { renderProgramMessage } from '@/lib/programs/chat'
import { SKILLS } from '@/lib/programs/skills'
import { CHARLIE_MESSAGE, CHARLIE_EVIDENCE } from './fixtures/charlie'
import { DRILL_POOL } from './fixtures/drill-pool'

async function main() {
  const intent = classifyIntent(CHARLIE_MESSAGE)
  console.log(`intent: ${intent.intent} (${intent.reasons.join('; ')})`)
  const { brief } = buildBrief({ message: CHARLIE_MESSAGE, playerId: 'p', playerName: 'Charlie', age: 9, positions: ['OF', 'P'], today: '2026-11-08' })
  const d = await generateProgram({ brief: brief!, evidence: CHARLIE_EVIDENCE, pool: DRILL_POOL })
  console.log(`\n${d.title}\n${d.summary}\n`)
  console.log('week  coached  independent  rest  skills trained (coached sessions)')
  for (let w = 1; w <= brief!.weeks; w++) {
    const s = d.sessions.filter(x => x.week === w)
    const skills = Array.from(new Set(s.filter(x => x.kind === 'coached' || x.kind === 'assessment').flatMap(x => x.blocks.filter(b => b.kind !== 'warmup' && b.kind !== 'cooldown').map(b => b.skill)).filter(Boolean))).length
    console.log(`${String(w).padStart(4)}  ${String(s.filter(x => x.kind === 'coached' || x.kind === 'assessment').length).padStart(7)}  ${String(s.filter(x => x.kind === 'independent').length).padStart(11)}  ${String(s.filter(x => x.kind === 'rest').length).padStart(4)}  ${skills}/${brief!.skills.length}  ${d.weeklyLoad[w - 1].label}${s.some(x => x.checkpoint) ? '  [' + Array.from(new Set(s.map(x => x.checkpoint).filter(Boolean))).join(',') + ']' : ''}`)
  }
  console.log(`\nrequested skills: ${brief!.skills.map(k => SKILLS[k].label).join(' | ')}`)
  console.log(`sessions: ${d.sessions.length} total, ${d.sessions.reduce((a, s) => a + s.blocks.reduce((b, x) => b + x.drills.length, 0), 0)} drill rows, ${d.sessions.flatMap(s => s.blocks.flatMap(b => b.drills)).filter(x => x.drillId).length} from the library (fixture pool)`)
  console.log(`phases: ${d.phases.map(p => `${p.name} wk${p.startWeek}-${p.endWeek}`).join(' → ')}`)
  console.log(`throwing gate: ${d.throwingGate?.cleared ? 'OPEN' : 'closed'}`)
  console.log(`assumptions:\n${d.assumptions.map(a => '  - ' + a).join('\n')}`)
  console.log(`curation flags: ${d.curationFlags.length ? '\n' + d.curationFlags.map(a => '  - ' + a).join('\n') : 'none'}`)
  console.log('\nquality checks:')
  for (const c of d.qualityReport!.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.id}: ${c.detail}`)
  const first = d.sessions.find(s => s.kind === 'coached' && s.week === 3)!
  console.log(`\nsample session ${first.key} (${first.date}) — ${first.title}, ${first.minutes} min, ${first.supervision}`)
  for (const b of first.blocks) { console.log(`  [${b.kind}] ${b.title} — ${b.minutes} min`); for (const x of b.drills) console.log(`      • ${x.name} (${x.minutes} min${x.sets ? `, ${x.sets} sets` : ''}${x.reps ? `, ${x.reps}` : ''}) ${x.drillId ? '[library]' : '[built-in]'}`) }
  console.log('\n--- what CoachAI would say in chat ---\n' + renderProgramMessage(d, 'Charlie'))
  if (d.qualityReport!.checks.some(c => !c.ok)) process.exit(1)
}
main()
