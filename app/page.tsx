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
//   "For Leagues"       there is no league marketing page. app/league holds
//                       only invite/. The draft is explicit: do not publish a
//                       dead link. Nav item and CTA omitted until a real
//                       destination exists.
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
                <span className="text-sm font-medium text-red-900">Youth baseball coaching support for 6U&ndash;12U</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 leading-tight">
                Show up to practice knowing what to work on.
              </h1>

              <p className="text-xl text-slate-700 leading-relaxed max-w-xl">
                Build a practice plan that fits your team. Find drills you know how to teach. Get help with the coaching questions that come up along the way.
              </p>

              <p className="text-lg text-slate-600 leading-relaxed max-w-xl">
                BenchCoach brings practice planning, drill guidance, and AI coaching support together&mdash;so you can spend less time figuring out what comes next and more time working with your players.
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
            You have a team to coach. And a whole day before practice.
          </h2>
          <div className="space-y-5 text-lg text-slate-300 leading-relaxed">
            <p>Work runs late. Field time is limited. Your players need different things.</p>
            <p className="text-white font-medium text-xl">
              Then comes the question: &ldquo;What are we working on tonight?&rdquo;
            </p>
            <p>
              You can spend the evening searching for drills and still wonder whether they fit your team. Or fall back on the same routine because there wasn&apos;t time to prepare anything else.
            </p>
            <p className="text-white">
              You care about doing a good job. You deserve practical support that helps you do it.
            </p>
          </div>
        </div>
      </section>

      {/* ── 3. Introduce the guide and the solution ─────────────────────── */}
      <section id="features" className="py-24 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-6">
              A little help planning. A clearer purpose for practice.
            </h2>
            <p className="text-lg text-slate-600 leading-relaxed mb-4">
              Built by youth baseball coach Clint Losch, BenchCoach helps you turn the things your team needs to work on into something you can take to the field.
            </p>
            <p className="text-lg text-slate-600 leading-relaxed mb-4">
              Start with your age group, available time, and practice focus. Use the plan and drill guidance to prepare, then adjust them for the players in front of you.
            </p>
            <p className="text-lg text-slate-800 font-medium leading-relaxed">
              You bring your knowledge of the kids. BenchCoach helps you organize what to do next.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                title: 'Plan the session',
                body: 'Build a practice around your team’s age, skill level, and goals. Review the activities, make changes, and save the plan for another day.',
                d: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
              },
              {
                title: 'Know how to teach the drill',
                body: 'Find setup instructions, coaching cues, and common mistakes to watch for. Go into the activity knowing what to explain and where to focus your feedback.',
                d: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
              },
              {
                title: 'Keep track of what needs attention',
                body: 'Keep team and player notes together so you can return to your observations when preparing the next practice.',
                d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
              },
              {
                title: 'Get help when you’re unsure',
                body: 'Ask the AI coaching assistant about a skill, a practice problem, or a player who needs a different approach. Review its suggestions and decide what fits your team.',
                d: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
              },
            ].map(card => (
              <div key={card.title} className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
                <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mb-5">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={card.d} />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{card.title}</h3>
                <p className="text-slate-600 leading-relaxed">{card.body}</p>
              </div>
            ))}
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
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-16 text-center">
            Your next practice starts with three steps.
          </h2>

          <div className="grid md:grid-cols-3 gap-10">
            {[
              {
                n: '1',
                title: 'Tell BenchCoach about your team',
                body: 'Choose your age group and the skills you want to work on.',
              },
              {
                n: '2',
                title: 'Build and review your practice',
                body: 'Set your available time, create a plan, and adjust the activities to fit your players.',
              },
              {
                n: '3',
                title: 'Take it to the field',
                body: 'Use the plan to guide the session. Save notes afterward to help you prepare for the next one.',
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
