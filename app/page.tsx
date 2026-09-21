'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'

// Homepage copy follows the StoryBrand / direct-response rewrite dated
// 2026-09-21. The structure stays behind the copy: coach as the character,
// limited preparation time as the external problem, feeling underprepared as
// the internal one, BenchCoach as the guide, a three-step plan, and Start Free
// Trial as the direct action.
//
// WHAT WAS VERIFIED BEFORE ANY OF IT WAS WRITTEN
//
//   $10/month           the previous page said it, and app/api/stripe/checkout
//                       bills STRIPE_PRICE_ID for the individual tier
//   14-day trial        trial_period_days: 14 in that same route
//   6U-12U              lib/ageGroups.ts actually runs 6U..13U+, so this
//                       UNDERSTATES the product rather than overstating it,
//                       and matches what the page already claimed
//   assistant coaches   real: lib/authz.ts roles and the Staff screen
//   notes, drills, AI   all real features with screens behind them
//
// WHAT THE DRAFT ASKED FOR AND IS DELIBERATELY NOT HERE
//
//   "See a Sample
//    Practice Plan"     no public sample plan exists and one cannot be
//                       invented here, so the draft's own fallback is used:
//                       "See How It Works" pointing at the three-step section.
//   Contact / Privacy
//   / Terms in footer   no such routes exist. Omitted rather than linked.
//   "Unlimited teams"   the previous page claimed it; the draft deliberately
//                       drops it as an unverified entitlement, so it is gone.
//
// No testimonials, no customer counts, no measured-improvement claims, and no
// "no credit card required" — Stripe Checkout in subscription mode collects a
// card, so that line would have been false.
//
// "For Leagues" WAS on that omitted list through three revisions, for want of
// anywhere to send a league buyer. /leagues exists now, so the nav item, the
// footer link and the features-section CTA all point at it.

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Navigation Header */}
      <header className="sticky top-0 z-50 bg-[#1a202c] border-b border-slate-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <Image src="/Bench_Coach_Logo.png" alt="Bench Coach" width={180} height={48} className="h-12 w-auto" />
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-8">
              <a href="#how-it-works" className="text-slate-300 hover:text-white font-medium transition-colors">How It Works</a>
              <a href="#features" className="text-slate-300 hover:text-white font-medium transition-colors">Features</a>
              {/* /use-cases is an existing indexed route — kept so the rewrite
                  does not quietly drop an SEO destination. */}
              <Link href="/use-cases" className="text-slate-300 hover:text-white font-medium transition-colors">Use Cases</Link>
              <Link href="/leagues" className="text-slate-300 hover:text-white font-medium transition-colors">For Leagues</Link>
              <a href="#pricing" className="text-slate-300 hover:text-white font-medium transition-colors">Pricing</a>
            </nav>

            {/* Desktop Auth Buttons */}
            <div className="hidden md:flex items-center gap-4">
              <Link href="/auth/login" className="text-slate-300 hover:text-white font-semibold transition-colors">Log In</Link>
              <Link href="/auth/signup" className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-all hover:scale-105">
                Start Free Trial
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-slate-300 hover:text-white p-2"
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-4 pb-4 border-t border-slate-700 pt-4">
              <nav className="flex flex-col gap-4">
                <a href="#how-it-works" className="text-slate-300 hover:text-white font-medium transition-colors">How It Works</a>
                <a href="#features" className="text-slate-300 hover:text-white font-medium transition-colors">Features</a>
                <Link href="/use-cases" className="text-slate-300 hover:text-white font-medium transition-colors">Use Cases</Link>
                <Link href="/leagues" className="text-slate-300 hover:text-white font-medium transition-colors">For Leagues</Link>
                <a href="#pricing" className="text-slate-300 hover:text-white font-medium transition-colors">Pricing</a>
                <div className="border-t border-slate-700 pt-4 mt-2 flex flex-col gap-3">
                  <Link href="/auth/login" className="text-slate-300 hover:text-white font-semibold transition-colors">Log In</Link>
                  <Link href="/auth/signup" className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-all text-center">
                    Start Free Trial
                  </Link>
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-20 pb-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-7">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-50 border border-red-200">
                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                <span className="text-sm font-medium text-red-900">Player development for youth baseball, 6U&ndash;12U</span>
              </div>

              {/* "Level up your players" is an aspiration, not a guarantee, and
                  the supporting copy deliberately carries the MECHANISM rather
                  than a promise of faster improvement. Nothing on this page
                  claims players get better in a given time, because nothing
                  measures that. */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 leading-tight">
                Level up your players.
                <span className="block text-red-600 mt-2">Build a stronger team.</span>
              </h1>

              <p className="text-xl text-slate-700 leading-relaxed max-w-xl">
                Know what to work on next&mdash;and give every practice a purpose.
              </p>

              {/* VERIFIED, and worth keeping verified. The practice planner
                  loads team_notes and writes per-player callouts into the
                  generation prompt (app/api/practice-plan/route.ts), and
                  CoachAI loads journal entries, notes, game stats, season
                  batting, past practices and saved drills. What it does NOT do
                  is read a player's development-plan STAGE and plan around it
                  on its own — the coach picks the pathway and stage by hand.
                  So this says your notes and your history shape what comes
                  back, which is true, and stops short of claiming the plan
                  knows where each player stands. */}
              <p className="text-lg text-slate-600 leading-relaxed max-w-xl">
                BenchCoach keeps your player observations, development plans, and progress in one place, so you can target the skills your players need most. Your notes and your season so far shape the coaching guidance, drills, and practice plans you get back.
              </p>

              <p className="text-lg text-slate-800 font-medium max-w-xl">
                Less guesswork. More focused development.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/auth/signup" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg hover:shadow-xl">
                  Start Free Trial
                  <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                {/* The draft asked for "See a Sample Practice Plan". No public
                    sample plan exists, so this is the draft's own stated
                    fallback rather than a link to nothing. */}
                <a href="#how-it-works" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-slate-700 bg-white rounded-lg hover:bg-slate-50 transition-all border-2 border-slate-200">
                  See How It Works
                </a>
              </div>

              <p className="text-sm text-slate-600">
                14-day free trial &bull; $10/month after your trial &bull; Cancel anytime
              </p>
            </div>

            {/* Hero screenshot — a real capture of the product, per the
                draft's instruction not to publish editorial placeholders. */}
            <div className="relative">
              <div className="relative">
                <div className="bg-slate-800 rounded-t-xl px-4 py-3 flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  </div>
                  <div className="flex-1 mx-4">
                    <div className="bg-slate-700 rounded-md px-3 py-1 text-xs text-slate-400 text-center">
                      mybenchcoach.com/dashboard
                    </div>
                  </div>
                </div>
                <div className="rounded-b-xl overflow-hidden shadow-2xl border-x-4 border-b-4 border-slate-800">
                  <Image
                    src="/screenshots/dashboard.png"
                    alt="A coach's BenchCoach dashboard, showing the team, recent practice plans and season goals"
                    width={800}
                    height={600}
                    className="w-full h-auto"
                    priority
                  />
                </div>
              </div>
              <div className="absolute -z-10 -top-4 -right-4 w-72 h-72 bg-red-200 rounded-full blur-3xl opacity-30"></div>
              <div className="absolute -z-10 -bottom-8 -left-8 w-64 h-64 bg-blue-200 rounded-full blur-3xl opacity-30"></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Recognize the problem ────────────────────────────────────── */}
      <section className="py-20 px-4 bg-[#1a202c]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-bold text-white mb-8">
            You can see what each kid needs. Keeping track of it is the hard part.
          </h2>
          <div className="space-y-5 text-lg text-slate-300 leading-relaxed">
            <p>
              One player steps out on the curveball. One cannot find the ball off the bat. One finally got their throw down last week and you have not built on it since.
            </p>
            <p className="text-white font-medium text-xl">
              Then comes the question: &ldquo;What are we working on tonight?&rdquo;
            </p>
            <p>
              You can spend the evening searching for drills and still wonder whether they fit the players you have. Or fall back on the same routine, and the things you noticed never turn into anything.
            </p>
            <p className="text-white">
              You care about doing a good job. You deserve practical support that helps you do it.
            </p>
          </div>
        </div>
      </section>

      {/* ── 3. Introduce the guide ──────────────────────────────────────── */}
      <section className="py-24 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-6">
              Give your players a clear path forward.
            </h2>
            <p className="text-lg text-slate-600 leading-relaxed mb-4">
              Built by youth baseball coach Clint Losch, BenchCoach helps you turn what you notice about your players into something you can take to the field.
            </p>
            <p className="text-lg text-slate-600 leading-relaxed mb-4">
              Whether you&apos;re helping your own child or coaching an entire team, the work carries forward: what you record about a player informs the practices you build and the advice you get back.
            </p>
            <p className="text-lg text-slate-800 font-medium leading-relaxed">
              You bring your knowledge of the kids. BenchCoach helps you organize what to do next.
            </p>
          </div>

        </div>
      </section>

      {/* ── 3b. Features ────────────────────────────────────────────────── */}
      {/*
        Nine cards. Each description was checked against the feature that
        actually ships before it was written, and two of the supplied drafts
        described something the product does not do:

        PLAYBOOKS. The draft read "Give your team a shared understanding of
        what to do on the field. Teach situations, responsibilities, and team
        execution with a clear reference." That is a situational playbook —
        cutoffs, bunt coverage, who backs up which base. BenchCoach's
        Playbooks are nothing of the kind: player_playbooks rows carry
        total_sessions, sessions_per_week and completed_sessions, and the
        screen is headed "Progression Playbooks". It is a multi-week TRAINING
        PROGRAMME you work through and tick off. A coach who subscribed on the
        strength of the original wording would have found the wrong feature,
        so the card describes the real one. The word "playbook" carrying a
        different meaning in baseball is exactly why this needs saying.

        SCOUTING. The draft read "Use AI-assisted scouting to help you
        understand opponents", which invites the reading that BenchCoach knows
        something about the opposition. It does not. Scouting is the coach's
        OWN recorded observations — lib/helpContent puts it as "Record what you
        saw of an opposing team and their pitchers" — plus help reading a
        bracket screenshot. Nothing is pooled between coaches, by design, so
        the card says whose notes these are.
      */}
      <section id="features" className="py-24 px-4 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-5">
              Everything you need to show up ready to coach.
            </h2>
            <p className="text-xl text-slate-600 leading-relaxed">
              Plan better practices, help players develop, and prepare for game day&mdash;all in one place.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: 'AI Practice Planner',
                body: 'Turn your team’s needs into a practice you can take to the field. Build around your age group, available time, and skills you want to improve.',
                d: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
              },
              {
                title: 'Player Development Plans',
                body: 'Give each player a clear next step. Work through skill stages one at a time, record what you see, and decide when they are ready to move on.',
                d: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
              },
              {
                title: 'AI Coaching Chat',
                body: 'Get help with the coaching questions that come up all season. Talk through mechanics, practice challenges, and ways to teach a skill.',
                d: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
              },
              {
                title: 'Drill Library',
                body: 'Find the right drill without another night of searching. Explore age-appropriate activities with setup instructions and coaching cues.',
                d: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
              },
              {
                title: 'Progression Playbooks',
                body: 'Follow a ready-made multi-week program. Start one for your whole team or a single player, run the sessions in order, and mark each one complete.',
                d: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
              },
              {
                title: 'Tournament Scouting',
                body: 'Head into your next travel tournament better prepared. Keep your own notes on teams and pitchers you have faced, and get help reading a bracket so you know who you might meet.',
                d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
              },
              {
                title: 'Player Development Reports',
                body: 'Give families a clear picture of their player’s development. Share strengths, areas to improve, and recommended drills in a report you write and review.',
                d: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
              },
              {
                title: 'Team & Player Notes',
                body: 'Keep your coaching observations in one place. Capture what’s working and what needs attention before planning your next session.',
                d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
              },
              {
                title: 'Assistant Coach Collaboration',
                body: 'Get your coaching staff on the same page. Invite assistants to help prepare and support your team throughout the season.',
                d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
              },
            ].map(card => (
              <div key={card.title} className="bg-white rounded-2xl p-7 border border-slate-200 shadow-sm">
                <div className="w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center mb-4">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={card.d} />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{card.title}</h3>
                <p className="text-slate-600 leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-14">
            <Link href="/auth/signup" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg">
              Start Free Trial
            </Link>
            {/* This link was omitted three times for want of a destination.
                /leagues exists now, so it points at it. */}
            <p className="mt-6 text-slate-600">
              Bringing BenchCoach to your entire league?{' '}
              <Link href="/leagues" className="text-red-600 hover:text-red-700 font-medium">
                Explore League Options &rarr;
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* ── 4. Demonstrate the product ──────────────────────────────────── */}
      {/* overflow-hidden contains the decorative offset panels behind the two
          screenshots. They are -left-6 / -right-6 on a w-full element, which
          lands 8px past a 390px viewport and gives the whole page a sideways
          scroll on a phone. The page had this before the rewrite; it is fixed
          here rather than carried forward. */}
      <section className="py-24 px-4 bg-slate-50 overflow-hidden">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-6">
                See what you could take to your next practice.
              </h2>
              <p className="text-lg text-slate-600 leading-relaxed mb-8">
                A plan lays out how the activities fit together, what each drill involves, and what to focus on while coaching it. Build one for your team, change what you want, and save it.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/auth/signup" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg">
                  Start Free Trial
                </Link>
                <a href="#how-it-works" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-slate-700 bg-white rounded-lg hover:bg-slate-100 transition-all border-2 border-slate-200">
                  See How It Works
                </a>
              </div>
            </div>
            <div className="relative">
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                <Image
                  src="/screenshots/practiceplanlibrary.png"
                  alt="A saved practice plan in BenchCoach, showing its activities and timings"
                  width={700}
                  height={500}
                  className="w-full h-auto"
                />
              </div>
              <div className="absolute -z-10 -top-6 -left-6 w-full h-full bg-red-100 rounded-2xl"></div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-16 items-center mt-24">
            <div className="order-2 lg:order-1 relative">
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
                <Image
                  src="/screenshots/aichat.png"
                  alt="Asking the BenchCoach AI coaching assistant a question about a practice problem"
                  width={700}
                  height={500}
                  className="w-full h-auto"
                />
              </div>
              <div className="absolute -z-10 -top-6 -right-6 w-full h-full bg-blue-100 rounded-2xl"></div>
            </div>
            <div className="order-1 lg:order-2">
              <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-6">
                Ask the question you&apos;d ask another coach.
              </h2>
              <p className="text-lg text-slate-600 leading-relaxed">
                A player who flinches at the ball. A skill that is not clicking. A practice that keeps running long. Ask about it, read what comes back, and decide what fits the kids in front of you.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. Give the reader a simple plan ────────────────────────────── */}
      <section id="how-it-works" className="py-24 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-5">
              Development is a loop, not a one-off practice.
            </h2>
            <p className="text-lg text-slate-600 leading-relaxed">
              What you notice about your players shapes what you work on. What you work on gives you something new to notice.
            </p>
          </div>

          {/* The loop is the positioning, and each step is something the
              product does today. Step 3 says "your notes and your history"
              rather than "your plans know where each player is", because the
              first is true and the second is not yet — the coach still picks
              the pathway and stage by hand. */}
          <div className="grid md:grid-cols-3 gap-10">
            {[
              {
                n: '1',
                title: 'Know your players',
                body: 'Capture strengths, challenges and what you saw at practice. Team and player notes keep your observations in one place instead of in your head.',
              },
              {
                n: '2',
                title: 'Target the right skills',
                body: 'Turn those needs into a development plan for a player, or a practice built around the skills your team needs most.',
              },
              {
                n: '3',
                title: 'Build on the work',
                body: 'Record what happened and advance a player when you judge they are ready. Your notes and your season so far feed back into the plans and advice you get next.',
              },
            ].map(step => (
              <div key={step.n} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-red-600 text-white text-2xl font-bold flex items-center justify-center mx-auto mb-5 shadow-lg">
                  {step.n}
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{step.title}</h3>
                <p className="text-slate-600 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-14">
            <Link href="/auth/signup" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg">
              Start Free Trial
            </Link>
          </div>
        </div>
      </section>

      {/* ── 6. Show the desired outcome ─────────────────────────────────── */}
      <section className="py-24 px-4 bg-[#1a202c]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-bold text-white mb-8">
            Spend practice helping your players take the next step.
          </h2>
          <div className="space-y-5 text-lg text-slate-300 leading-relaxed">
            <p>
              There&apos;s a difference between arriving with a few drill ideas and arriving with a plan you understand.
            </p>
            <p>
              You know what the session is for. You know what you&apos;re teaching. And when a player needs extra help, you have somewhere to start.
            </p>
            <p>
              That leaves more of your attention for the moments you signed up for: a kid making a clean catch, trying again after a mistake, or finally understanding what you&apos;ve been teaching.
            </p>
            <p className="text-white font-medium text-xl pt-2">
              Make room for more of those moments. Start with a plan for your next practice.
            </p>
          </div>
        </div>
      </section>

      {/* ── 7. Parent pathway ───────────────────────────────────────────── */}
      {/* The draft's league pathway sits between these two. It is not here:
          there is no league marketing page to send anyone to, and the draft
          says plainly not to publish a dead link. */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-5">
            Working with your own player? Start here, too.
          </h2>
          <p className="text-lg text-slate-600 leading-relaxed mb-8">
            Find drills and coaching guidance for the skills your child wants to work on. Whether you&apos;re planning backyard practice or looking for a different way to explain a skill, BenchCoach can help you prepare.
          </p>
          <Link href="/auth/signup" className="inline-flex items-center text-lg font-semibold text-red-600 hover:text-red-700">
            Start Free Trial
            <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </section>

      {/* ── 8. Offer ────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-4 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-5">
              Put BenchCoach to work before your next practice.
            </h2>
            <p className="text-xl text-slate-600">
              Use your trial to build a practice plan, explore the drill guidance, and ask a coaching question you&apos;ve been trying to answer.
            </p>
          </div>

          <div className="max-w-lg mx-auto">
            <div className="bg-white rounded-3xl border-4 border-red-600 overflow-hidden shadow-2xl">
              <div className="bg-red-600 text-white text-center py-4">
                <span className="text-sm font-semibold uppercase tracking-wide">
                  14 days to try it. Then $10/month.
                </span>
              </div>

              <div className="p-10 sm:p-12">
                <div className="text-center mb-8">
                  <div className="mb-3">
                    <span className="text-5xl font-bold text-slate-900">$10</span>
                    <span className="text-xl text-slate-600">/month</span>
                  </div>
                  <p className="text-slate-600">Your coach subscription includes:</p>
                </div>

                <ul className="space-y-4 mb-8">
                  {[
                    'Practice planning tools',
                    'AI coaching assistance',
                    'Drill guidance and coaching cues',
                    'Team and player notes',
                    'Assistant coach collaboration',
                  ].map(item => (
                    <li key={item} className="flex items-start gap-3">
                      <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="text-slate-700">{item}</span>
                    </li>
                  ))}
                </ul>

                <Link href="/auth/signup" className="block w-full text-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg mb-4">
                  Start Free Trial
                </Link>

                <p className="text-center text-sm text-slate-600">Cancel anytime.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 9. Questions before you start ───────────────────────────────── */}
      <section className="py-24 px-4 bg-white">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-12 text-center">
            Questions before you start
          </h2>

          <dl className="space-y-8">
            {[
              {
                q: 'I’m new to coaching. Will this help me?',
                a: 'BenchCoach gives you a place to start: practice plans, drill instructions, and a coaching assistant you can ask for help. Review the suggestions, keep things appropriate for your players, and build from there.',
              },
              {
                q: 'I’ve coached for years. Why would I use it?',
                a: 'Use BenchCoach to organize your preparation, find drill ideas for a particular skill, and keep your notes together. Bring your experience to the plan and change it to suit your team.',
              },
              {
                q: 'What ages is it for?',
                a: 'BenchCoach focuses on youth baseball from 6U through 12U, with practice plans and guidance for different ages and skill levels.',
              },
              {
                q: 'Can I change the practice plans?',
                a: 'Yes. Review and customize a plan so it fits your team and what you want to accomplish at practice.',
              },
              {
                q: 'Can assistant coaches help?',
                a: 'Yes. Invite assistant coaches to collaborate so they can prepare with you.',
              },
              {
                q: 'Can I use it with my own child?',
                a: 'Yes. BenchCoach also supports parents looking for drills and coaching guidance for practice at home.',
              },
              {
                q: 'What does it cost?',
                a: 'The individual coach subscription is $10/month after a 14-day free trial. You can cancel anytime.',
              },
            ].map(item => (
              <div key={item.q} className="border-b border-slate-200 pb-8 last:border-0">
                <dt className="text-lg font-bold text-slate-900 mb-3">{item.q}</dt>
                <dd className="text-slate-600 leading-relaxed">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── 10. Final call to action ────────────────────────────────────── */}
      <section className="py-24 px-4 bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl lg:text-5xl font-bold text-white mb-6">
            Make your next practice easier to prepare for.
          </h2>
          <p className="text-xl text-slate-300 mb-10">
            Choose what your team needs to work on. Build your plan. Show up ready to coach.
          </p>

          <Link href="/auth/signup" className="inline-flex items-center justify-center px-10 py-5 text-xl font-bold text-slate-900 bg-red-400 rounded-lg hover:bg-red-300 transition-all hover:scale-105 shadow-2xl">
            Start Free Trial
            <svg className="ml-2 w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>

          <p className="text-slate-400 text-sm mt-8">
            14-day free trial &bull; $10/month after your trial &bull; Cancel anytime
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-4 border-t border-slate-800">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div>
              <Image src="/Bench_Coach_Logo.png" alt="Bench Coach" width={150} height={40} className="h-10 w-auto mb-4" />
              <p className="text-sm">
                BenchCoach &mdash; practice planning and coaching support for youth baseball.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a></li>
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><Link href="/use-cases" className="hover:text-white transition-colors">Use Cases</Link></li>
                <li><Link href="/leagues" className="hover:text-white transition-colors">For Leagues</Link></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Account</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/auth/login" className="hover:text-white transition-colors">Log In</Link></li>
                <li><Link href="/auth/signup" className="hover:text-white transition-colors">Start Free Trial</Link></li>
              </ul>
            </div>
          </div>
          {/* Contact, Privacy Policy and Terms are in the draft's footer and
              are not here: no such routes exist yet. */}
          <div className="border-t border-slate-800 pt-8 text-center text-sm">
            <p>&copy; 2026 BenchCoach. Built by a coach, for coaches and parents.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
