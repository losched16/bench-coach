'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'

export default function UseCasesPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navigation Header */}
      <header className="sticky top-0 z-50 bg-[#1a202c] border-b border-slate-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <Image src="/Bench_Coach_Logo.png" alt="Bench Coach" width={180} height={48} className="h-12 w-auto" />
            </Link>
            
            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-8">
              <a href="/#features" className="text-slate-300 hover:text-white font-medium transition-colors">Features</a>
              <a href="/#how-it-works" className="text-slate-300 hover:text-white font-medium transition-colors">How It Works</a>
              <Link href="/use-cases" className="text-slate-300 hover:text-white font-medium transition-colors">Use Cases</Link>
              <a href="/#pricing" className="text-slate-300 hover:text-white font-medium transition-colors">Pricing</a>
            </nav>

            {/* Desktop Auth Buttons */}
            <div className="hidden md:flex items-center gap-4">
              <Link href="/auth/login" className="text-slate-300 hover:text-white font-semibold transition-colors">Log In</Link>
              <Link href="/auth/signup" className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-all hover:scale-105">
                Get Started
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-slate-300 hover:text-white p-2"
              aria-label="Toggle menu"
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
                <a href="/#features" className="text-slate-300 hover:text-white font-medium transition-colors">Features</a>
                <a href="/#how-it-works" className="text-slate-300 hover:text-white font-medium transition-colors">How It Works</a>
                <Link href="/use-cases" className="text-slate-300 hover:text-white font-medium transition-colors">Use Cases</Link>
                <a href="/#pricing" className="text-slate-300 hover:text-white font-medium transition-colors">Pricing</a>
                <div className="border-t border-slate-700 pt-4 mt-2 flex flex-col gap-3">
                  <Link href="/auth/login" className="text-slate-300 hover:text-white font-semibold transition-colors">Log In</Link>
                  <Link href="/auth/signup" className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-all text-center">
                    Get Started
                  </Link>
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>
      {/* Hero */}
      <section className="relative bg-[#0f172a] py-20 px-6 text-center overflow-hidden">
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="inline-block bg-red-600/12 text-red-500 px-4 py-2 rounded-full text-sm font-semibold mb-6 border border-red-500/20">
            ⚾ Real Ways Real People Use BenchCoach
          </div>
          <h1 className="text-4xl md:text-[3.4rem] font-extrabold text-white mb-5 leading-tight tracking-tight">
            See Yourself <span className="text-red-500">In Action</span>
          </h1>
          <p className="text-xl text-slate-400 max-w-[620px] mx-auto leading-relaxed">
            Practice plans, skill tracking, drill libraries, player journals, and AI coaching — here&apos;s exactly how BenchCoach fits into your routine.
          </p>
        </div>
      </section>

      {/* Persona Quick Nav */}
      <div className="max-w-7xl mx-auto px-6 -mt-12 relative z-20 mb-20">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { emoji: '📋', label: 'Practice Plans', id: 'practice-plans' },
            { emoji: '📈', label: 'Player Development', id: 'player-dev' },
            { emoji: '🏡', label: 'Parent at Home', id: 'parent-home' },
            { emoji: '🎯', label: 'Private Lessons', id: 'private-lessons' },
            { emoji: '🆕', label: 'First-Time Coach', id: 'first-time' },
            { emoji: '🏆', label: 'Travel Ball', id: 'travel-ball' },
            { emoji: '🤝', label: 'Assistant Coach', id: 'assistant' },
          ].map((persona) => (
            <a
              key={persona.id}
              href={`#${persona.id}`}
              className="bg-white rounded-xl p-4 text-center hover:shadow-lg hover:-translate-y-1 transition-all duration-200 border-2 border-slate-200 hover:border-red-400"
            >
              <div className="text-3xl mb-2">{persona.emoji}</div>
              <div className="text-xs font-semibold text-slate-700 leading-tight">{persona.label}</div>
            </a>
          ))}
        </div>
      </div>

      {/* Use Cases Container */}
      <div className="max-w-7xl mx-auto px-6 pb-20">
        
        {/* ====== USE CASE 1: PRACTICE PLANS ====== */}
        <section id="practice-plans" className="mb-20 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center text-3xl flex-shrink-0">📋</div>
            <div>
              <div className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-2">Coach</div>
              <h2 className="text-3xl font-bold text-slate-900 leading-tight">Build Better Practice Plans in 2 Minutes</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600 leading-relaxed">
                  &quot;I used to spend Sunday nights Googling drills and scribbling on notecards. Now I tell BenchCoach what we need to work on and I have a full plan before my coffee gets cold.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Mike, 10U Rec League Head Coach</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">The Problem</h3>
              <p className="text-slate-600 mb-6 leading-relaxed">
                You have 75 minutes of field time, 14 kids at different skill levels, and no idea what to do after warmups. You end up running the same three drills every practice because they&apos;re the only ones you remember.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">How BenchCoach Helps</h3>
              <p className="text-slate-600 leading-relaxed">
                Open the Practice Plan Generator, set your duration, pick your focus areas, and hit generate. In seconds you get a timed, structured plan with setup instructions, coaching cues to say out loud, and what to watch for. Every drill is age-appropriate and tailored to your team. Save it to your library so you never lose it — and your assistant coaches can access it too.
              </p>
            </div>

            <div className="bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 p-8 flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">📸</div>
                <p className="text-slate-500 font-semibold">Screenshot: Practice Plan Generator</p>
                <p className="text-slate-400 text-sm mt-2">App mockup showing generated practice plan</p>
              </div>
            </div>
          </div>
        </section>

        {/* ====== USE CASE 2: PLAYER DEVELOPMENT ====== */}
        <section id="player-dev" className="mb-20 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center text-3xl flex-shrink-0">📈</div>
            <div>
              <div className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-2">Coach</div>
              <h2 className="text-3xl font-bold text-slate-900 leading-tight">Track Every Player&apos;s Growth Over the Season</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600 leading-relaxed">
                  &quot;At the end of last season, a parent asked me how their son improved. I had nothing to show them. This year, I can pull up a player&apos;s whole development history in seconds.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Sarah, 8U Coach & Mom of Two Players</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">The Problem</h3>
              <p className="text-slate-600 mb-6 leading-relaxed">
                You notice things during practice — Jake is dropping his elbow, Emma finally made a throw to first — but by the time you get home, you&apos;ve forgotten the details. There&apos;s no record of what each kid is working on or how far they&apos;ve come.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">How BenchCoach Helps</h3>
              <p className="text-slate-600 leading-relaxed">
                Every player on your roster has a profile with six skill ratings you set with a single click — hitting, throwing, fielding, pitching, baserunning, and coachability. After practice, add a journal entry with notes and photos. The AI reads all of this, so when you ask &quot;What should Jake work on?&quot; it gives advice based on his actual skill levels and history — not generic tips.
              </p>
            </div>

            <div className="bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 p-8 flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">📸</div>
                <p className="text-slate-500 font-semibold">Screenshot: Player Profile</p>
                <p className="text-slate-400 text-sm mt-2">Skill ratings and development journal</p>
              </div>
            </div>
          </div>
        </section>

        {/* ====== USE CASE 3: PARENT AT HOME ====== */}
        <section id="parent-home" className="mb-20 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center text-3xl flex-shrink-0">🏡</div>
            <div>
              <div className="text-sm font-bold text-green-600 uppercase tracking-wide mb-2">Parent</div>
              <h2 className="text-3xl font-bold text-slate-900 leading-tight">Make Backyard Practice Actually Productive</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600 leading-relaxed">
                  &quot;My son wants to practice every day after school. I played softball in high school but I&apos;m not sure what to work on with an 8-year-old. I don&apos;t want to teach him bad habits.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Danielle, Mom of an 8-Year-Old Outfielder</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">The Problem</h3>
              <p className="text-slate-600 mb-6 leading-relaxed">
                You want to help your kid get better, but you&apos;re not sure what drills are age-appropriate, what mechanics to look for, or whether you&apos;re doing more harm than good. You end up just playing catch or doing the same soft toss over and over.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">How BenchCoach Helps</h3>
              <p className="text-slate-600 leading-relaxed">
                Open the Drill Library and search for exactly what you need — &quot;throwing drills for 8U&quot; or &quot;backyard hitting with a tee.&quot; Every drill comes with step-by-step setup, coaching cues you can say out loud, common mistakes to watch for, and how long it takes. Need a full session? Ask the AI to build a 20-minute backyard plan with just the equipment you have.
              </p>
            </div>

            <div className="bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 p-8 flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">📸</div>
                <p className="text-slate-500 font-semibold">Screenshot: Drill Library</p>
                <p className="text-slate-400 text-sm mt-2">Search results with drill instructions</p>
              </div>
            </div>
          </div>
        </section>

        {/* ====== USE CASE 4: PRIVATE LESSONS ====== */}
        <section id="private-lessons" className="mb-20 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center text-3xl flex-shrink-0">🎯</div>
            <div>
              <div className="text-sm font-bold text-green-600 uppercase tracking-wide mb-2">Parent</div>
              <h2 className="text-3xl font-bold text-slate-900 leading-tight">Get More From Every Private Lesson Dollar</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600 leading-relaxed">
                  &quot;We&apos;re paying $75 a session for hitting lessons. The instructor is great, but by the time we get home, my daughter can&apos;t remember what they worked on. I started taking notes in BenchCoach after each lesson — game changer.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Tom, Dad of a 10-Year-Old Travel Ball Player</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">The Problem</h3>
              <p className="text-slate-600 mb-6 leading-relaxed">
                Private lessons are expensive. The instructor gives great feedback during the session, but kids forget 80% of it by the next day. You&apos;re paying for knowledge that evaporates. Between lessons, you don&apos;t know what to practice to reinforce what they learned.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">How BenchCoach Helps</h3>
              <p className="text-slate-600 leading-relaxed">
                After each lesson, open your child&apos;s player journal and log what the instructor worked on — the cues, the drills, any homework. Upload a video clip from the session. The AI connects the dots across entries, so when you ask &quot;What should Sophia practice this week?&quot; it knows she&apos;s been working on keeping her hands inside because of a casting issue the instructor flagged three lessons ago.
              </p>
            </div>

            <div className="bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 p-8 flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">📸</div>
                <p className="text-slate-500 font-semibold">Screenshot: Lesson Journal</p>
                <p className="text-slate-400 text-sm mt-2">Journal entries with video uploads</p>
              </div>
            </div>
          </div>
        </section>

        {/* ====== USE CASE 5: FIRST-TIME COACH ====== */}
        <section id="first-time" className="mb-20 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center text-3xl flex-shrink-0">🆕</div>
            <div>
              <div className="text-sm font-bold text-purple-600 uppercase tracking-wide mb-2">Volunteer Coach</div>
              <h2 className="text-3xl font-bold text-slate-900 leading-tight">&quot;I Don&apos;t Know Baseball — But I Said I&apos;d Coach&quot;</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600 leading-relaxed">
                  &quot;No one else volunteered, so here I am coaching 6U t-ball. I played soccer growing up. I literally Googled &apos;how to run a baseball practice&apos; the night before our first one.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Kevin, First-Time 6U T-Ball Coach</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">The Problem</h3>
              <p className="text-slate-600 mb-6 leading-relaxed">
                Millions of youth sports teams are coached by volunteer parents who may have never played the sport. You want to give these kids a great experience, but you&apos;re learning along with them. Every question feels embarrassing to ask another coach.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">How BenchCoach Helps</h3>
              <p className="text-slate-600 leading-relaxed">
                Ask anything with zero judgment. The AI gives clear, age-appropriate answers for someone who isn&apos;t a baseball expert. But Kevin also uses the Practice Plan Generator to get ready-made plans, and the Drill Library to find drills he can run with zero prior experience. It&apos;s like having a patient, knowledgeable co-coach who never makes you feel dumb.
              </p>
            </div>

            <div className="bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 p-8 flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">📸</div>
                <p className="text-slate-500 font-semibold">Screenshot: AI Chat</p>
                <p className="text-slate-400 text-sm mt-2">First practice plan conversation</p>
              </div>
            </div>
          </div>
        </section>

        {/* ====== USE CASE 6: TRAVEL BALL ====== */}
        <section id="travel-ball" className="mb-20 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center text-3xl flex-shrink-0">🏆</div>
            <div>
              <div className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-2">Coach</div>
              <h2 className="text-3xl font-bold text-slate-900 leading-tight">Run a Competitive Travel Ball Program</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600 leading-relaxed">
                  &quot;I&apos;m managing 13 kids on a 12U travel roster. Parents are paying tournament fees and expecting results. I need to track who&apos;s improving, who needs extra work, and keep practices sharp between tournaments.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Derek, 12U Travel Ball Head Coach</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">The Problem</h3>
              <p className="text-slate-600 mb-6 leading-relaxed">
                Travel ball is a different animal. Parents are invested — financially and emotionally. You&apos;re preparing for specific opponents, managing playing time conversations, and trying to develop 13 players at different speeds. You need data, not hunches.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">How BenchCoach Helps</h3>
              <p className="text-slate-600 leading-relaxed">
                Your full roster lives in BenchCoach with skill ratings across all six categories. Sort by weakest area to find your biggest team gaps. The AI analyzes your entire roster to recommend what practices should focus on. Use the player journal to track individual progress so when parents ask &quot;How&apos;s my son doing?&quot; you pull up a profile with concrete evidence — not a vague &quot;he&apos;s doing great.&quot;
              </p>
            </div>

            <div className="bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 p-8 flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">📸</div>
                <p className="text-slate-500 font-semibold">Screenshot: Team Roster</p>
                <p className="text-slate-400 text-sm mt-2">Skill ratings grid with team insights</p>
              </div>
            </div>
          </div>
        </section>

        {/* ====== USE CASE 7: ASSISTANT COACH ====== */}
        <section id="assistant" className="mb-20 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center text-3xl flex-shrink-0">🤝</div>
            <div>
              <div className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-2">Assistant Coach</div>
              <h2 className="text-3xl font-bold text-slate-900 leading-tight">Run Practice When the Head Coach Can&apos;t Make It</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600 leading-relaxed">
                  &quot;Coach Dave texted me at 2pm — &apos;Can you run practice tonight? I&apos;m stuck at work.&apos; I panicked. Then I opened BenchCoach and had a plan ready by the time I got to the field.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Chris, Assistant Coach for 8U Rec League</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">The Problem</h3>
              <p className="text-slate-600 mb-6 leading-relaxed">
                The head coach can&apos;t make it. You&apos;re on your own with 12 kids, anxious parents watching, and no plan. You know the basics, but you don&apos;t know what the team has been working on or what&apos;s next.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3 text-lg">How BenchCoach Helps</h3>
              <p className="text-slate-600 leading-relaxed">
                Assistant coaches get free access to the team&apos;s BenchCoach account. You can see every practice plan the head coach has run this season, the team&apos;s skill focus areas, and notes on each player. Browse the Practice Plan Library to see recent plans, then generate a new one that continues those themes — or just re-run a recent plan. No guessing, no disruption.
              </p>
            </div>

            <div className="bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 p-8 flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">📸</div>
                <p className="text-slate-500 font-semibold">Screenshot: Plan Library</p>
                <p className="text-slate-400 text-sm mt-2">Shared practice plans from head coach</p>
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* CTA Section */}
      <section className="bg-[#0f172a] py-20 px-6 text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-6 leading-tight tracking-tight">
            Which One Sounds Like You?
          </h2>
          <p className="text-xl text-slate-400 mb-10 leading-relaxed">
            Whether you&apos;re a seasoned travel ball coach tracking 13 players or a parent learning alongside your kid in the backyard — BenchCoach meets you where you are. Try it free.
          </p>
          <Link 
            href="/auth/signup"
            className="inline-block px-10 py-5 bg-red-600 text-white text-lg font-bold rounded-xl hover:bg-red-700 transition-all hover:scale-105 shadow-2xl"
          >
            Start Your Free Trial →
          </Link>
          <div className="text-slate-500 text-sm mt-6">
            $10/month after trial • Unlimited assistant coaches included
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-6 border-t border-slate-800">
        <div className="max-w-7xl mx-auto text-center text-sm">
          © 2026 BenchCoach. Built by a coach, for coaches and parents.
        </div>
      </footer>
    </div>
  )
}
