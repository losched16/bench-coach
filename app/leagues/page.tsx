'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'

// BenchCoach for Leagues.
//
// EVERY CAPABILITY CLAIM HERE WAS READ OFF THE FEATURE, not written from a
// pitch deck:
//
//   seasons / divisions / teams   the league dashboard's real objects
//   invite links                  the admin copies a link and sends it
//                                 themselves; nothing is emailed from here
//   sponsorship                   attaches to the TEAM, not the coach
//                                 (lib/authz.ts: isTeamLeagueSponsored), and
//                                 lifts the paywall for that team's coaches
//   adoption only                 invited / accepted / opened / plan counts
//   the boundary                  there is NO route from the league dashboard
//                                 into a plan's contents, a player note, a
//                                 scouting report or a CoachAI conversation
//
// WHAT IS DELIBERATELY NOT HERE: a price. There is no league tier in Stripe —
// lib/tiers.ts knows free, personal and team — so league access is a
// conversation, not a checkout, and inventing a number would be inventing a
// product decision. The form is the call to action instead.
//
// The privacy boundary is the lead, not a footnote. A commissioner deciding
// whether to put a tool in front of other people's children has one question
// before any other, and answering it plainly is the most persuasive thing this
// page can do.

interface FormState {
  name: string
  email: string
  phone: string
  league: string
  size: string
  message: string
}

const EMPTY: FormState = { name: '', email: '', phone: '', league: '', size: '', message: '' }

export default function LeaguesPage() {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
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
        setError(data.error || 'That did not go through. Please try again.')
        setState('error')
        return
      }
      setState('sent')
    } catch {
      setError('That did not go through. Please check your connection and try again.')
      setState('error')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <header className="sticky top-0 z-50 bg-[#1a202c] border-b border-slate-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <Image src="/Bench_Coach_Logo.png" alt="Bench Coach" width={180} height={48} className="h-12 w-auto" />
            </Link>
            <nav className="hidden md:flex items-center gap-8">
              <Link href="/#how-it-works" className="text-slate-300 hover:text-white font-medium transition-colors">How It Works</Link>
              <Link href="/#features" className="text-slate-300 hover:text-white font-medium transition-colors">Features</Link>
              <Link href="/use-cases" className="text-slate-300 hover:text-white font-medium transition-colors">Use Cases</Link>
              <Link href="/#pricing" className="text-slate-300 hover:text-white font-medium transition-colors">Pricing</Link>
            </nav>
            <div className="hidden md:flex items-center gap-4">
              <Link href="/auth/login" className="text-slate-300 hover:text-white font-semibold transition-colors">Log In</Link>
              <a href="#inquiry" className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-all hover:scale-105">
                Ask About League Access
              </a>
            </div>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-slate-300 hover:text-white p-2"
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d={mobileMenuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
              </svg>
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden mt-4 pb-4 border-t border-slate-700 pt-4">
              <nav className="flex flex-col gap-4">
                <Link href="/#how-it-works" className="text-slate-300 hover:text-white font-medium">How It Works</Link>
                <Link href="/#features" className="text-slate-300 hover:text-white font-medium">Features</Link>
                <Link href="/use-cases" className="text-slate-300 hover:text-white font-medium">Use Cases</Link>
                <Link href="/#pricing" className="text-slate-300 hover:text-white font-medium">Pricing</Link>
                <div className="border-t border-slate-700 pt-4 mt-2 flex flex-col gap-3">
                  <Link href="/auth/login" className="text-slate-300 hover:text-white font-semibold">Log In</Link>
                  <a href="#inquiry" className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg text-center">
                    Ask About League Access
                  </a>
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="pt-20 pb-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-50 border border-red-200 mb-7">
            <div className="w-2 h-2 rounded-full bg-red-500"></div>
            <span className="text-sm font-medium text-red-900">BenchCoach for Leagues</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight mb-6">
            Help every coach in your league show up prepared.
          </h1>
          <p className="text-xl text-slate-700 leading-relaxed mb-5">
            Your coaches bring different levels of experience. They all face the same question on the way to the field: what are we working on tonight?
          </p>
          <p className="text-lg text-slate-600 leading-relaxed mb-9">
            Sponsor BenchCoach for your teams and give every coach practice planning, drill guidance and coaching support&mdash;without asking volunteers to pay for it themselves.
          </p>
          <a href="#inquiry" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg">
            Ask About League Access
          </a>
        </div>
      </section>

      {/* The boundary — deliberately above the feature list */}
      <section className="py-16 px-4 bg-[#1a202c]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl lg:text-3xl font-bold text-white mb-6 text-center">
            What a league administrator can and cannot see.
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-800/60 rounded-2xl p-7 border border-slate-700">
              <h3 className="text-lg font-bold text-white mb-4">You can see adoption</h3>
              <ul className="space-y-3 text-slate-300">
                {[
                  'Which coaches you invited',
                  'Who accepted and who has not',
                  'Who has actually opened the app',
                  'How many practice plans exist across the league',
                ].map(t => (
                  <li key={t} className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-slate-800/60 rounded-2xl p-7 border border-slate-700">
              <h3 className="text-lg font-bold text-white mb-4">You cannot see coaching</h3>
              <ul className="space-y-3 text-slate-300">
                {[
                  'What is inside a practice plan',
                  'Any note a coach wrote about a player',
                  'Scouting reports on other teams',
                  'Anything a coach asked the AI assistant',
                ].map(t => (
                  <li key={t} className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-slate-300 text-center mt-8 text-lg leading-relaxed">
            This is deliberate. <span className="text-white font-medium">Sponsoring a league does not give you access to what its coaches record about children.</span> If you also coach a team in the league, that access comes from being on that team&mdash;not from administering the league.
          </p>
        </div>
      </section>

      {/* What you get */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-900 mb-12 text-center">
            What league access gives you.
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: 'Set up your season',
                body: 'Create a season, add your divisions and teams, and keep the structure of the league in one place.',
              },
              {
                title: 'Invite your coaches',
                body: 'Generate an invitation link for each team. You send it yourself, and the coach signs up through it and lands on their own team.',
              },
              {
                title: 'Sponsor their access',
                body: 'Sponsorship attaches to the team, so its coaches get the full product without paying individually. A coach can run a sponsored team and their own side at once.',
              },
            ].map(c => (
              <div key={c.title} className="bg-slate-50 rounded-2xl p-7 border border-slate-200">
                <h3 className="text-lg font-bold text-slate-900 mb-3">{c.title}</h3>
                <p className="text-slate-600 leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-slate-600 mt-10 max-w-2xl mx-auto leading-relaxed">
            Coaches get everything on the individual plan&mdash;practice planning, the drill library, development plans, AI coaching support, notes and assistant collaboration.{' '}
            <Link href="/#features" className="text-red-600 hover:text-red-700 font-medium">See the full list &rarr;</Link>
          </p>
        </div>
      </section>

      {/* Inquiry */}
      <section id="inquiry" className="py-20 px-4 bg-slate-50">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-bold text-slate-900 mb-4 text-center">
            Tell us about your league.
          </h2>
          {/* No price, on purpose: there is no league tier in Stripe, so this
              is a conversation rather than a checkout. Saying "it depends on
              the size of your league" is true; a number would not be. */}
          <p className="text-slate-600 text-center mb-10 leading-relaxed">
            What it costs depends on the size of your league and how many teams you want to cover. Tell us what you are running and we will come back to you.
          </p>

          {state === 'sent' ? (
            <div className="bg-white rounded-2xl p-10 border-2 border-green-500 text-center">
              <svg className="w-12 h-12 text-green-500 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Thanks&mdash;that came through.</h3>
              <p className="text-slate-600">
                We have your details and will be in touch about {form.league || 'your league'}.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm space-y-5">
              {[
                { k: 'name' as const, label: 'Your name', type: 'text', required: true, ph: '' },
                { k: 'email' as const, label: 'Email', type: 'email', required: true, ph: '' },
                { k: 'league' as const, label: 'League name', type: 'text', required: true, ph: '' },
                { k: 'size' as const, label: 'How many teams?', type: 'text', required: false, ph: 'e.g. 12 teams, 6U–12U' },
                { k: 'phone' as const, label: 'Phone (optional)', type: 'tel', required: false, ph: '' },
              ].map(f => (
                <div key={f.k}>
                  <label htmlFor={f.k} className="block text-sm font-medium text-slate-700 mb-1.5">
                    {f.label}{f.required && <span className="text-red-600"> *</span>}
                  </label>
                  <input
                    id={f.k}
                    type={f.type}
                    required={f.required}
                    value={form[f.k]}
                    onChange={set(f.k)}
                    placeholder={f.ph}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  />
                </div>
              ))}
              <div>
                <label htmlFor="message" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Anything else? (optional)
                </label>
                <textarea
                  id="message"
                  rows={4}
                  value={form.message}
                  onChange={set('message')}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
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
                {state === 'sending' ? 'Sending…' : 'Ask About League Access'}
              </button>
              <p className="text-xs text-slate-500 text-center">
                We will only use this to talk to you about BenchCoach for your league.
              </p>
            </form>
          )}
        </div>
      </section>

      {/* Coach CTA */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            Coaching a team yourself?
          </h2>
          <p className="text-slate-600 mb-6 leading-relaxed">
            You do not need a league to use BenchCoach. Start a free trial and build your next practice today.
          </p>
          <Link href="/auth/signup" className="inline-flex items-center text-lg font-semibold text-red-600 hover:text-red-700">
            Start Free Trial
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
