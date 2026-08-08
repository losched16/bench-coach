// Does the book reconcile?
//
// The scorebook is the one part of this app where "usually right" is worthless.
// A run that appears or disappears makes the whole book untrustworthy, and the
// coach finds out three innings later when nothing adds up.
//
// So the defaults in lib/scorebook.ts are tested against the situations that
// actually catch people out: a walk with a runner on second and first open, a
// foul ball on an 0-2 count, a sacrifice fly with two already out. Every one of
// these is a bug someone has shipped.
//
//   npm run test:scorebook

import {
  applyPA, applyBaseEvent, addPitch, NEW_COUNT, impliedResult,
  EMPTY_BASES, GameState, Runner, boxScore, StoredEvent, ip, advanceIfHalfOver,
} from '@/lib/scorebook'

const R = (n: string): Runner => ({ id: n, name: n, earned: true })
const S = (bases: any, outs = 0): GameState =>
  ({ inning: 1, half: 'top', outs, bases: { ...EMPTY_BASES, ...bases }, awayRuns: 0, homeRuns: 0 })

let fails = 0
const eq = (name: string, got: any, want: any) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { fails++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`) }
  else console.log(`ok   ${name}`)
}
const at = (b: any) => [b.first?.id ?? null, b.second?.id ?? null, b.third?.id ?? null]

// ── Walks: the force logic ────────────────────────────
let r = applyPA(S({}), 'BB', R('B'))
eq('BB, bases empty', [at(r.bases), r.scored.map(x=>x.id), r.outs], [['B',null,null], [], 0])

r = applyPA(S({ first: R('A') }), 'BB', R('B'))
eq('BB, man on 1st', [at(r.bases), r.scored.map(x=>x.id)], [['B','A',null], []])

r = applyPA(S({ second: R('A') }), 'BB', R('B'))
eq('BB, man on 2nd only (NOT forced)', [at(r.bases), r.scored.map(x=>x.id)], [['B',null,null].map((v,i)=> i===1?'A':v), []])

r = applyPA(S({ first: R('A'), third: R('C') }), 'BB', R('B'))
eq('BB, 1st and 3rd', [at(r.bases), r.scored.map(x=>x.id)], [['B','A','C'], []])

r = applyPA(S({ first: R('A'), second: R('C') }), 'BB', R('B'))
eq('BB, 1st and 2nd', [at(r.bases), r.scored.map(x=>x.id)], [['B','A','C'], []])

r = applyPA(S({ first: R('A'), second: R('C'), third: R('D') }), 'BB', R('B'))
eq('BB, bases loaded -> run forced in', [at(r.bases), r.scored.map(x=>x.id)], [['B','A','C'], ['D']])

// ── Hits ──────────────────────────────────────────────
r = applyPA(S({ first: R('A') }), '2B', R('B'))
eq('2B, man on 1st -> 1st to 3rd', [at(r.bases), r.scored.map(x=>x.id)], [[null,'B','A'], []])

r = applyPA(S({ second: R('A'), third: R('C') }), '2B', R('B'))
eq('2B, 2nd+3rd both score', [at(r.bases), r.scored.map(x=>x.id)], [[null,'B',null], ['C','A']])

r = applyPA(S({ first: R('A'), second: R('C') }), 'HR', R('B'))
eq('HR with 2 on -> 3 runs', [at(r.bases), r.scored.map(x=>x.id)], [[null,null,null], ['C','A','B']])

r = applyPA(S({ third: R('C') }), '1B', R('B'))
eq('1B scores man from 3rd', [at(r.bases), r.scored.map(x=>x.id)], [['B',null,null], ['C']])

// ── Outs and the third out ────────────────────────────
r = applyPA(S({ third: R('C') }, 2), 'SF', R('B'))
eq('SF with 2 outs -> no run, inning over', [r.outs, r.scored.map(x=>x.id), at(r.bases)], [3, [], [null,null,null]])

r = applyPA(S({ third: R('C') }, 1), 'SF', R('B'))
eq('SF with 1 out -> run scores', [r.outs, r.scored.map(x=>x.id)], [2, ['C']])

r = applyPA(S({ first: R('A') }, 1), 'DP', R('B'))
eq('DP with 1 out -> inning over, nobody left', [r.outs, at(r.bases)], [3, [null,null,null]])

r = applyPA(S({ first: R('A'), second: R('C'), third: R('D') }), 'FC', R('B'))
eq('FC bases loaded -> out at home, no run', [at(r.bases), r.scored.map(x=>x.id), r.outs], [['B','A','C'], [], 1])

r = applyPA(S({ first: R('A') }), 'K', R('B'))
eq('K -> nobody moves', [at(r.bases), r.outs], [['A',null,null], 1])

// ── Base events ───────────────────────────────────────
r = applyBaseEvent(S({ first: R('A') }), 'SB', 1)
eq('SB from 1st', [at(r.bases), r.outs], [[null,'A',null], 0])

r = applyBaseEvent(S({ third: R('C') }), 'PB', 3)
eq('PB scores from 3rd, unearned', [r.scored.map(x=>[x.id,x.earned])], [[['C',false]]])

r = applyBaseEvent(S({ second: R('A') }, 1), 'CS', 2)
eq('CS -> out, off the bases', [at(r.bases), r.outs], [[null,null,null], 2])

// ── The count ─────────────────────────────────────────
let c = NEW_COUNT
c = addPitch(c, 'strike'); c = addPitch(c, 'strike')
eq('two strikes', [c.balls, c.strikes, c.pitches], [0, 2, 2])
c = addPitch(c, 'foul')
eq('foul at 2 strikes is a pitch, not a K', [c.balls, c.strikes, c.pitches, impliedResult(c)], [0, 2, 3, null])
c = addPitch(c, 'strike')
eq('strike three', [c.strikes, impliedResult(c)], [3, 'K'])

c = NEW_COUNT
for (let i = 0; i < 4; i++) c = addPitch(c, 'ball')
eq('ball four', [c.balls, c.pitches, impliedResult(c)], [4, 4, 'BB'])

// ── Half-inning rollover ──────────────────────────────
eq('3 outs in the top -> bottom, same inning',
  (() => { const s = advanceIfHalfOver({ ...S({first:R('A')},3), half:'top', inning: 4 }); return [s.inning, s.half, s.outs, at(s.bases)] })(),
  [4, 'bottom', 0, [null,null,null]])
eq('3 outs in the bottom -> next inning, top',
  (() => { const s = advanceIfHalfOver({ ...S({},3), half:'bottom', inning: 4 }); return [s.inning, s.half] })(),
  [5, 'top'])

// ── Box score reconciles ──────────────────────────────
const ev = (o: Partial<StoredEvent>): StoredEvent => ({
  seq: 0, kind: 'pa', inning: 1, half: 'top', weBatting: true, result: '1B',
  batterId: null, batterName: null, pitcherId: null, balls: 0, strikes: 0,
  pitches: 0, rbi: 0, outsAfter: 0, basesAfter: EMPTY_BASES, scored: [], scoring: null, ...o,
})
const book: StoredEvent[] = [
  ev({ seq:1, batterId:'p1', result:'1B', outsAfter:0 }),
  ev({ seq:2, batterId:'p2', result:'BB', outsAfter:0 }),
  ev({ seq:3, batterId:'p3', result:'HR', rbi:3, outsAfter:0, scored:[R('p1'),R('p2'),R('p3')] }),
  ev({ seq:4, batterId:'p4', result:'K', outsAfter:1 }),
  ev({ seq:5, batterId:'p1', result:'GO', outsAfter:2 }),
  ev({ seq:6, batterId:'p2', result:'FO', outsAfter:3 }),
  // their half — our pitcher works
  ev({ seq:7, half:'bottom', weBatting:false, pitcherId:'a1', result:'K', pitches:5, strikes:3, outsAfter:1 }),
  ev({ seq:8, half:'bottom', weBatting:false, pitcherId:'a1', result:'1B', pitches:2, outsAfter:1 }),
  ev({ seq:9, half:'bottom', weBatting:false, pitcherId:'a1', result:'HR', pitches:1, outsAfter:1,
       scored:[{id:'x',name:'x',earned:true},{id:'y',name:'y',earned:true}] }),
  ev({ seq:10, half:'bottom', weBatting:false, pitcherId:'a1', result:'GO', pitches:3, outsAfter:2 }),
  ev({ seq:11, half:'bottom', weBatting:false, pitcherId:'a1', result:'GO', pitches:3, outsAfter:3 }),
]
const box = boxScore(book, { p1:'One', p2:'Two', p3:'Three', p4:'Four', a1:'Arm' })
const p3 = box.batting.find(b => b.playerId === 'p3')!
eq('HR hitter: 1 AB, 1 H, 1 HR, 3 RBI, 1 R', [p3.ab, p3.h, p3.hr, p3.rbi, p3.runs], [1,1,1,3,1])
const p2 = box.batting.find(b => b.playerId === 'p2')!
eq('walked then flew out: 2 PA, 1 AB, 1 BB, 1 R', [p2.pa, p2.ab, p2.bb, p2.runs], [2,1,1,1])
const arm = box.pitching.find(p => p.playerId === 'a1')!
eq('pitcher: 3 outs = 1.0 IP, 14 pitches, 2 H, 1 K, 2 R', [ip(arm.outs), arm.pitches, arm.h, arm.k, arm.runs, arm.earned], ['1.0',14,2,1,2,2])
eq('line score reconciles with the runs', [box.awayRuns, box.homeRuns], [3, 2])


// ── Runner identity: the trip, not the player ─────────
// The bug this guards: a walk with a runner already on first showed TWO rows
// both called "Batter", both on 1st, and refused to save. Two causes — a
// missing lineup made every batter the same placeholder id, and even with a
// lineup a kid who reached and batted again in the same inning collided with
// himself. Both are the same mistake: keying a runner by the player.
const T = (trip: string, player: string, name: string): Runner =>
  ({ id: trip, playerId: player, name, earned: true })

r = applyPA(S({ first: T('t1', 'p9', 'Sam') }), 'BB', T('t2', 'p9', 'Sam'))
eq('same player on base AND batting -> two distinct runners',
  [at(r.bases), new Set(Object.values(r.bases).filter(Boolean).map((x: any) => x.id)).size],
  [['t2', 't1', null], 2])

r = applyPA(S({ first: T('t1', 'p1', 'A'), second: T('t2', 'p2', 'B'), third: T('t3', 'p3', 'C') }),
            'BB', T('t4', 'p1', 'A'))
eq('bases loaded walk, the forced run belongs to the player not the trip',
  [r.scored.map(x => [x.id, x.playerId]), at(r.bases)],
  [[['t3', 'p3']], ['t4', 't1', 't2']])

// Runs credit the player, so a kid who scores twice gets two runs.
const twice: StoredEvent[] = [
  ev({ seq:1, batterId:'p1', result:'1B' }),
  ev({ seq:2, batterId:'p2', result:'HR', rbi:2,
       scored:[{id:'t1',playerId:'p1',name:'One',earned:true},
               {id:'t2',playerId:'p2',name:'Two',earned:true}] }),
  ev({ seq:3, batterId:'p1', result:'1B' }),
  ev({ seq:4, batterId:'p2', result:'HR', rbi:2,
       scored:[{id:'t3',playerId:'p1',name:'One',earned:true},
               {id:'t4',playerId:'p2',name:'Two',earned:true}] }),
]
const bx2 = boxScore(twice, { p1:'One', p2:'Two' })
eq('same player scoring twice gets 2 runs, not 2 phantom players',
  [bx2.batting.length, bx2.batting.find(b => b.playerId === 'p1')!.runs],
  [2, 2])

// Old rows have no playerId — the id WAS the player id then.
const legacy: StoredEvent[] = [
  ev({ seq:1, batterId:'p1', result:'HR', rbi:1, scored:[{id:'p1',name:'One',earned:true} as any] }),
]
eq('a run written before playerId existed still lands on the right player',
  boxScore(legacy, { p1:'One' }).batting.find(b => b.playerId === 'p1')?.runs, 1)

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
