'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'

// BenchCoach for Leagues — the sales page, from the draft dated 2026-09-21.
//
// Buyer: presidents, commissioners, coaching directors and boards. Primary
// action: request a demo. Parents are a benefit the league can communicate,
// not a second thing to sell.
//
// WHAT THE DRAFT ASKED TO HAVE VERIFIED, AND WHAT THE CHECK FOUND
//
//   AI access to team/player context   REAL. app/api/chat/route.ts loads 24
//                                      tables into context, among them
//                                      team_notes, player_journal_entries,
//                                      player_game_stats, player_season_batting,
//                                      practice_plans and saved_drills.
//   saved notes                        REAL. The practice planner loads
//                                      team_notes and writes per-player
//                                      callouts into the generation prompt.
//   assistant permissions              REAL, with a nuance the copy respects:
//                                      notes are 'record', so an assistant can
//                                      write them; BUILDING a plan is 'decide',
//                                      so an assistant reads and runs plans
//                                      rather than creating them.
//   supported age groups               lib/ageGroups.ts runs 6U..13U+. The page
//                                      says 6U-12U, which understates it and
//                                      matches the rest of the marketing.
//   plan customization                 REAL — "Swap Drill" and "Use this plan"
//                                      are actual controls.
//
// HELD TO, from the draft's own boundaries: "context" means information
// supplied to the assistant, never "AI watches your players", automatic
// diagnosis, continuous learning or independent assessment of progress. The
// development cycle described is coach-led throughout. No claim of measured
// improvement, guaranteed results, wins, fewer complaints, or registration
// and retention effects.
//
// DELIBERATELY ABSENT
//
//   price              lib/tiers.ts has free, personal and team — there is no
//                      league tier, so terms are a conversation. The draft
//                      invents none and neither does this.
//   scouting           the draft says it belongs to a travel-program pitch
//                      rather than the rec-league one. Left off.
//   testimonials,
//   logos, badges      none exist, so none are shown.
//   parent email copy  that is collateral for AFTER a league adopts, not
//                      sales-page copy. It lives in docs/league-sales-page.md.

interface FormState {
  name: string; email: string; league: string; role: string
  size: string; ageGroups: string; improve: string; phone: string
}

const EMPTY: FormState = {
  name: '', email: '', league: '', role: '', size: '', ageGroups: '', improve: '', phone: '',
}

export default function LeaguesPage() {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const set = (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('sending')
    setError(null)
    try {
      const res = await fetch('/api/league-inquiry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Entries are preserved on failure and a retry is offered, per the
        // draft: losing what someone typed is the worst possible outcome here.
        setError(data.error || 'That did not go through. Your details are still here — please try again.')
        setState('idle')
        return
      }
      setState('sent')
    } catch {
      setError('That did not go through. Your details are still here — please check your connection and try again.')
      setState('idle')
    }
  }

  return (
    <div className="min-h-screen bg-white">
      {/* ── 1. Navigation ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-[#1a202c] border-b border-slate-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <Image src="/Bench_Coach_Logo.png" alt="Bench Coach" width={180} height={48} className="h-12 w-auto" />
            </Link>
            <nav className="hidden md:flex items-center gap-7">
              <Link href="/" className="text-slate-300 hover:text-white font-medium transition-colors">For Coaches</Link>
              <a href="#why" className="text-slate-300 hover:text-white font-medium transition-colors">Why BenchCoach</a>
              <a href="#how" className="text-slate-300 hover:text-white font-medium transition-colors">How It Works</a>
              <a href="#questions" className="text-slate-300 hover:text-white font-medium transition-colors">League Questions</a>
            </nav>
            <div className="hidden md:flex items-center gap-4">
              <a href="#demo" className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-all hover:scale-105">
                Request a League Demo
              </a>
            </div>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden text-slate-300 hover:text-white p-2"
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d={menuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
              </svg>
            </button>
          </div>
          {menuOpen && (
            <div className="md:hidden mt-4 pb-4 border-t border-slate-700 pt-4">
              <nav className="flex flex-col gap-4">
                <Link href="/" className="text-slate-300 hover:text-white font-medium">For Coaches</Link>
                <a href="#why" className="text-slate-300 hover:text-white font-medium">Why BenchCoach</a>
                <a href="#how" className="text-slate-300 hover:text-white font-medium">How It Works</a>
                <a href="#questions" className="text-slate-300 hover:text-white font-medium">League Questions</a>
                <a href="#demo" className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg text-center mt-2">
                  Request a League Demo
                </a>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* ── 2. Hero ─────────────────────────────────────────────────────── */}
      <section className="pt-20 pb-16 px-4 bg-gradient-to-br from-slate-50 via-white to-slate-100">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-sm font-semibold tracking-wide text-red-700 uppercase mb-5">
            BenchCoach for youth baseball leagues
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight mb-7">
            Invest in your coaches. Give every player a better chance to develop.
          </h1>
          <p className="text-xl text-slate-700 leading-relaxed mb-5">
            Equip your volunteer coaches with practice plans, drill guidance, and AI coaching support built around the teams and players they&apos;re working with.
          </p>
          <p className="text-lg text-slate-600 leading-relaxed mb-9">
            Help coaches turn what they see on the field into more focused practice&mdash;and give families a clear reason to value your league&apos;s investment in player development.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a href="#demo" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg">
              Request a League Demo
            </a>
            <a href="#why" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-slate-700 bg-white rounded-lg hover:bg-slate-50 transition-all border-2 border-slate-200">
              See How It Helps Your League
            </a>
          </div>
          <p className="text-sm text-slate-500 mt-7">
            For league presidents, commissioners, and coaching directors serving 6U&ndash;12U baseball.
          </p>
        </div>
      </section>

      {/* ── 3. The problem ──────────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-[#1a202c]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl lg:text-4xl font-bold text-white mb-8 text-center">
            You found people willing to coach. Now give them the support to do it well.
          </h2>
          <div className="space-y-5 text-lg text-slate-300 leading-relaxed">
            <p>
              You know how much work it takes to put a season together. Registration. Fields. Equipment. Schedules. Finding enough adults willing to step onto the field.
            </p>
            <p>Then those volunteers face a different set of decisions:</p>
            <ul className="space-y-2.5 pl-1">
              {[
                'What should we work on at practice?',
                'How do I teach this skill to this age group?',
                'What do I do when one player needs something different?',
                'How do we build on what we worked on last week?',
              ].map(q => (
                <li key={q} className="flex items-start gap-3">
                  <span className="text-red-500 mt-1.5 flex-shrink-0">&bull;</span>
                  <span className="text-white">{q}</span>
                </li>
              ))}
            </ul>
            <p>
              An experienced coach may have a system. A first-time volunteer may be searching for drills after the kids go to bed.
            </p>
            <p>Both care about their players. Both can benefit from practical help.</p>
            <p className="text-white font-medium text-xl pt-2">
              Your league can make that support part of the season.
            </p>
          </div>
        </div>
      </section>

      {/* ── 4. The solution and guide ───────────────────────────────────── */}
      <section id="why" className="py-20 px-4 bg-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-7">
            Put a player-development resource behind your coaching staff.
          </h2>
          <div className="space-y-5 text-lg text-slate-600 leading-relaxed">
            <p>
              Built by youth baseball coach Clint Losch, BenchCoach brings practice planning, drill guidance, player notes, and AI coaching assistance into one place.
            </p>
            <p>
              Coaches can prepare around their team&apos;s age, skill level, and goals, keep track of what they observe, and ask for help with the situations they face.
            </p>
            <p className="text-slate-800 font-medium">
              That gives your league a concrete way to support the people responsible for teaching the game&mdash;throughout the season, as new questions come up.
            </p>
          </div>
        </div>
      </section>

      {/* ── 5. Benefits for coaches ─────────────────────────────────────── */}
      <section className="py-20 px-4 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-14 text-center max-w-2xl mx-auto">
            Give coaches something they can use at the next practice.
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                t: 'Practice plans with a purpose',
                b: 'Help coaches turn available field time and team priorities into a structured session. They can review the plan, adjust the activities, and arrive knowing what they want to teach.',
              },
              {
                t: 'Drills they know how to run',
                b: 'Setup instructions, coaching cues, and common mistakes give coaches more than a drill name. They have guidance for explaining the activity and helping players through it.',
              },
              {
                t: 'AI help for the questions that come up',
                b: 'From catching confidence to choosing a practice focus, coaches have a place to ask questions and explore an approach. They review the suggestions and decide what fits their players.',
              },
              {
                t: 'Team and player context',
                b: 'Keep observations and notes together. The coaching assistant is given relevant context about the team and players, so its guidance can address the situation the coach describes.',
              },
              {
                t: 'A record to build on',
                b: 'Return to player notes and previous plans when preparing the next session. Keep the things that need attention in view as the season moves forward.',
              },
              {
                t: 'Support for assistant coaches',
                b: 'Bring assistants into the preparation. They can add team and player notes and work from the same plans, so the coaching staff understands what they are working on together.',
              },
            ].map(c => (
              <div key={c.t} className="bg-white rounded-2xl p-7 border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900 mb-3">{c.t}</h3>
                <p className="text-slate-600 leading-relaxed">{c.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. Benefits for players ─────────────────────────────────────── */}
      <section id="how" className="py-20 px-4 bg-white">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-7 text-center">
            Make the next practice more relevant to the players on the field.
          </h2>
          <div className="space-y-5 text-lg text-slate-600 leading-relaxed mb-10">
            <p>A team can share an age group without sharing the same development needs.</p>
            <p>
              One player is learning to trust their glove. Another needs more accurate throws. Another understands a drill but struggles to use the skill in a game.
            </p>
            <p>BenchCoach helps coaches organize those observations and find ways to work on them.</p>
          </div>

          {/* Every step here is something the COACH does. The draft is explicit
              that the cycle must not be depicted as automated progress
              tracking or automatic plan advancement, and it is not. */}
          <div className="grid sm:grid-cols-2 gap-5 mb-10">
            {[
              ['Choose a focus', 'Identify a skill or challenge that needs attention.'],
              ['Put it into practice', 'Select relevant activities and clear teaching cues.'],
              ['Observe and record', 'Note what the coach sees during the session.'],
              ['Build from there', 'Use those observations to inform what comes next.'],
            ].map(([t, b], i) => (
              <div key={t} className="flex gap-4 bg-slate-50 rounded-xl p-5 border border-slate-200">
                <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-600 text-white text-sm font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">{t}</h3>
                  <p className="text-slate-600 text-base leading-relaxed">{b}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xl text-slate-900 font-medium text-center">
            Give coaches a way to connect what they notice with what they teach.
          </p>
        </div>
      </section>

      {/* ── 7. Benefits for the league ──────────────────────────────────── */}
      <section className="py-20 px-4 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-14 text-center max-w-2xl mx-auto">
            Turn your commitment to development into something coaches can use.
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                t: 'Support volunteers after they say yes',
                b: 'A coaching assignment comes with questions all season long. BenchCoach gives volunteers somewhere to turn while they prepare, teach, and adjust.',
              },
              {
                t: 'Give teams a shared foundation',
                b: 'Offer access to a common coaching resource while allowing each coach to adapt practice to the players in front of them.',
              },
              {
                t: 'Make your development priorities actionable',
                b: 'If your league wants coaches to emphasize fundamentals, provide tools that help them plan activities and teach those skills.',
              },
              {
                t: 'Give your board an investment it can explain',
                b: 'Connect the purchase to a clear purpose: equipping the adults who work with your players. Show families what that support looks like in a practice plan or drill example.',
              },
            ].map(c => (
              <div key={c.t} className="bg-white rounded-2xl p-7 border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900 mb-3">{c.t}</h3>
                <p className="text-slate-600 leading-relaxed">{c.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 8. Parent value — visually distinct panel ───────────────────── */}
      <section className="py-20 px-4 bg-[#1a202c]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-8 text-center">
            An investment you can explain to parents in one sentence.
          </h2>
          {/* Proposed messaging the LEAGUE can use. Not a testimonial, and
              marked up as a quote rather than attributed to anyone. */}
          <blockquote className="bg-slate-800/60 border-l-4 border-red-500 rounded-r-2xl p-7 mb-8">
            <p className="text-xl text-white leading-relaxed">
              &ldquo;We&apos;re investing in coaching resources to help our volunteers run more purposeful practices and support your child&apos;s development.&rdquo;
            </p>
          </blockquote>
          <div className="space-y-5 text-lg text-slate-300 leading-relaxed">
            <p>Then show them what that means.</p>
            <p>
              Practice plans that help coaches prepare. Drill instructions that help them teach. Notes that help them remember what needs work. Coaching guidance they can consult during the season.
            </p>
            <p>
              This gives your league something specific to communicate at registration, in a preseason email, or at a parent meeting: you&apos;re putting resources behind the experience children have on the field.
            </p>
            <p className="text-white font-medium text-xl pt-2">
              Make coach support a visible part of the value your league provides.
            </p>
          </div>
        </div>
      </section>

      {/* ── 9. Product demonstration ────────────────────────────────────── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-14 items-center">
            <div>
              <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-6">
                See the connection between a coaching need and a practice plan.
              </h2>
              <p className="text-lg text-slate-600 leading-relaxed mb-5">
                In your league demo, explore how BenchCoach can help a coach prepare for a team skill focus, find drills with teaching guidance, and keep observations for future sessions.
              </p>
              <p className="text-lg text-slate-600 leading-relaxed mb-8">
                Look at the tools your coaches would use. Ask how they fit your age groups. Discuss what bringing BenchCoach to your league would involve.
              </p>
              <a href="#demo" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg">
                Request a League Demo
              </a>
            </div>
            {/* A real capture of the product, per the draft: no editorial
                placeholders, no invented dashboards. */}
            <div className="relative">
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                <Image
                  src="/screenshots/practiceplanlibrary.png"
                  alt="A saved BenchCoach practice plan, showing its activities and timings"
                  width={700}
                  height={500}
                  className="w-full h-auto"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 10. Path to purchase ────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-14 text-center">
            Give your board a clear next step.
          </h2>
          <div className="grid md:grid-cols-3 gap-10">
            {[
              ['1', 'Tell us about your league', 'Share your age groups, approximate team count, and what you want to improve about coach support and player development.'],
              ['2', 'See BenchCoach in action', 'Walk through the coaching experience and discuss the questions that matter to your board and volunteers.'],
              ['3', 'Review your league options', 'Discuss access, pricing, and rollout requirements so your board can decide whether BenchCoach fits your league.'],
            ].map(([n, t, b]) => (
              <div key={n} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-red-600 text-white text-2xl font-bold flex items-center justify-center mx-auto mb-5 shadow-lg">
                  {n}
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{t}</h3>
                <p className="text-slate-600 leading-relaxed">{b}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <a href="#demo" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg">
              Request a League Demo
            </a>
          </div>
        </div>
      </section>

      {/* ── 11. Investment ──────────────────────────────────────────────── */}
      {/* No figure. There is no league tier in lib/tiers.ts, so terms are a
          conversation and a number here would be manufactured. */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-7">
            Put resources behind the people who teach the game.
          </h2>
          <div className="space-y-5 text-lg text-slate-600 leading-relaxed mb-9">
            <p>
              Your league invests in the things it takes to play baseball. Coaching support deserves a place in that conversation.
            </p>
            <p>
              BenchCoach gives your board a way to invest in practice preparation, skill instruction, and more focused attention to development across the teams you equip.
            </p>
            <p className="text-slate-800 font-medium">
              Tell us about your league to discuss pricing and access options.
            </p>
          </div>
          <a href="#demo" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg">
            Discuss League Pricing
          </a>
        </div>
      </section>

      {/* ── 12. FAQ ─────────────────────────────────────────────────────── */}
      <section id="questions" className="py-20 px-4 bg-slate-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-12 text-center">
            League questions
          </h2>
          <dl className="space-y-8">
            {[
              ['Is this useful for coaches who have never coached before?',
                'BenchCoach provides a starting point: practice plans, drill instructions, coaching cues, and a place to ask questions. A new volunteer can use that guidance while learning what works for their players.'],
              ['What about our experienced coaches?',
                'Experienced coaches can use it to organize preparation, explore drills for a particular need, and keep team and player observations together. They retain control over what they teach and how they run practice.'],
              ['How does it help individual players?',
                'Coaches can record what they notice about a player, and that context informs the guidance they get back. It helps connect practice decisions to the needs they identify. Player improvement still depends on instruction, practice, and the individual child.'],
              ['Does the AI make coaching decisions?',
                'No. The coach reviews the suggestions and decides what to use. BenchCoach provides planning and guidance; the coach remains responsible for instruction, safety, and what is appropriate for the team.'],
              ['Does every coach have to run the same practice?',
                'No. Coaches can customize practice plans for their teams. Your league can encourage shared priorities while allowing coaches to adjust activities to the age, ability, and needs of their players.'],
              ['We already use an app for schedules and team communication. Why consider BenchCoach?',
                'Evaluate BenchCoach for practice planning, teaching guidance, and player-development support. Those are the coaching tasks this page focuses on. During the demo, discuss how your coaches would use it alongside their existing tools.'],
              ['What can a league administrator see?',
                'Adoption, not coaching. You can see which coaches you invited, who accepted, who has opened the app, and how many plans exist. There is no route from the league dashboard into a plan’s contents, a note a coach wrote about a player, or a conversation with the coaching assistant. Sponsoring a league does not give you access to what its coaches record about children.'],
              ['What should we tell parents?',
                'Explain the investment in practical terms: your league is providing coaching resources to help volunteers prepare practices, teach skills, and pay attention to development. Show an example and describe how your league intends to use it.'],
              ['How much does league access cost?',
                'Request league pricing so you can review the access and terms appropriate for your organization. Share your approximate team count and age groups when you inquire.'],
            ].map(([q, a]) => (
              <div key={q} className="border-b border-slate-200 pb-8 last:border-0">
                <dt className="text-lg font-bold text-slate-900 mb-3">{q}</dt>
                <dd className="text-slate-600 leading-relaxed">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── 13. Closing ─────────────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-bold text-white mb-7">
            Give your coaches support they can bring to the field.
          </h2>
          <p className="text-lg text-slate-300 leading-relaxed mb-5">
            Your volunteers give their time. Your players bring their enthusiasm. Your league can provide resources that help turn both into purposeful practice.
          </p>
          <p className="text-lg text-slate-300 leading-relaxed mb-9">
            See how BenchCoach could support your coaches, your players, and the season your families are counting on.
          </p>
          <a href="#demo" className="inline-flex items-center justify-center px-10 py-5 text-xl font-bold text-slate-900 bg-red-400 rounded-lg hover:bg-red-300 transition-all hover:scale-105 shadow-2xl">
            Request a League Demo
          </a>
          <p className="text-slate-400 text-sm mt-7">
            Tell us about your league. See the product. Decide whether it fits.
          </p>
        </div>
      </section>

      {/* ── 14. Inquiry form ────────────────────────────────────────────── */}
      <section id="demo" className="py-20 px-4 bg-white">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-900 mb-4 text-center">
            Let&apos;s talk about your league.
          </h2>
          <p className="text-slate-600 text-center mb-10 leading-relaxed">
            Tell us a little about your organization so we can discuss the right fit.
          </p>

          {state === 'sent' ? (
            <div className="bg-white rounded-2xl p-10 border-2 border-green-500 text-center">
              <svg className="w-12 h-12 text-green-500 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                Thanks for your interest in BenchCoach.
              </h3>
              <p className="text-slate-600">
                We&apos;ve received your league inquiry and will follow up using the email you provided.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="bg-slate-50 rounded-2xl p-8 border border-slate-200 space-y-5">
              {([
                ['name', 'Your name', 'text', true, ''],
                ['email', 'Email', 'email', true, ''],
                ['league', 'League name', 'text', true, ''],
                ['role', 'Your role', 'text', true, 'e.g. President, Coaching Director'],
                ['size', 'Approximate number of teams', 'text', true, 'e.g. 14'],
                ['ageGroups', 'Age groups (optional)', 'text', false, 'e.g. 6U–12U'],
                ['phone', 'Phone (optional)', 'tel', false, ''],
              ] as const).map(([k, label, type, required, ph]) => (
                <div key={k}>
                  <label htmlFor={k} className="block text-sm font-medium text-slate-700 mb-1.5">
                    {label}{required && <span className="text-red-600"> *</span>}
                  </label>
                  <input
                    id={k}
                    type={type}
                    required={required}
                    value={form[k]}
                    onChange={set(k)}
                    placeholder={ph}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  />
                </div>
              ))}
              <div>
                <label htmlFor="improve" className="block text-sm font-medium text-slate-700 mb-1.5">
                  What would you most like to improve? (optional)
                </label>
                <textarea
                  id="improve"
                  rows={4}
                  value={form.improve}
                  onChange={set('improve')}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={state === 'sending'}
                className="w-full px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg disabled:opacity-60"
              >
                {state === 'sending' ? 'Sending…' : 'Request a League Demo'}
              </button>
              <p className="text-xs text-slate-500 text-center">
                We will only use this to talk to you about BenchCoach for your league.
              </p>
            </form>
          )}
        </div>
      </section>

      {/* Coach CTA */}
      <section className="py-14 px-4 bg-slate-50 border-t border-slate-200">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-slate-600 mb-4">
            Coaching a team yourself? You do not need a league to use BenchCoach.
          </p>
          <Link href="/" className="inline-flex items-center font-semibold text-red-600 hover:text-red-700">
            See BenchCoach for coaches
            <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </section>

      <footer className="bg-slate-900 text-slate-400 py-12 px-4 border-t border-slate-800">
        <div className="max-w-6xl mx-auto text-center text-sm">
          <Image src="/Bench_Coach_Logo.png" alt="Bench Coach" width={150} height={40} className="h-10 w-auto mb-4 mx-auto" />
          <p className="mb-4">BenchCoach &mdash; practice planning and coaching support for youth baseball.</p>
          <p>&copy; 2026 BenchCoach. Built by a coach, for coaches and parents.</p>
        </div>
      </footer>
    </div>
  )
}
