import Link from 'next/link'
import Image from 'next/image'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Navigation Header */}
      <header className="sticky top-0 z-50 bg-[#1a202c] border-b border-slate-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <Image src="/Bench_Coach_Logo.png" alt="Bench Coach" width={180} height={48} className="h-12 w-auto" />
            </Link>
            
            <nav className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-slate-300 hover:text-white font-medium transition-colors">Features</a>
              <a href="#how-it-works" className="text-slate-300 hover:text-white font-medium transition-colors">How It Works</a>
              <a href="#pricing" className="text-slate-300 hover:text-white font-medium transition-colors">Pricing</a>
            </nav>

            <div className="flex items-center gap-4">
              <Link href="/auth/login" className="text-slate-300 hover:text-white font-semibold transition-colors">Log In</Link>
              <Link href="/auth/signup" className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-all hover:scale-105">
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-20 pb-32 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-50 border border-red-200">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                <span className="text-sm font-medium text-red-900">Built by a coach, for coaches &amp; parents</span>
              </div>
              
              <h1 className="text-5xl lg:text-7xl font-bold text-slate-900 leading-tight">
                Stop Winging It.
                <span className="block text-red-600 mt-2">Start Coaching.</span>
              </h1>
              
              <p className="text-xl text-slate-600 leading-relaxed max-w-xl">
                Whether you&apos;re coaching a full team or just helping your own kid get better, Bench Coach gives you practice plans, drills, and AI guidance—even if you&apos;ve never coached before.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/auth/signup" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg hover:shadow-xl">
                  Start Free Trial
                  <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                <a href="#how-it-works" className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-slate-700 bg-white rounded-lg hover:bg-slate-50 transition-all border-2 border-slate-200">
                  See How It Works
                </a>
              </div>

              <div className="flex items-center gap-6 pt-4 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>14-day free trial</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Set up in 2 minutes</span>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl border-8 border-white bg-gradient-to-br from-slate-100 to-slate-200 min-h-[400px] flex items-center justify-center">
                <div className="text-center p-8">
                  <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                    <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <p className="text-slate-600 font-medium">Dashboard Preview</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Perfect For Section */}
      <section className="py-16 px-4 bg-[#1a202c]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
              Perfect For Teams <span className="text-red-500">AND</span> Individual Players
            </h2>
            <p className="text-slate-300 text-lg max-w-2xl mx-auto">
              Whether you&apos;re managing 12 kids or focused on developing your own child, Bench Coach adapts to your situation.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-slate-800/50 rounded-2xl p-8 border border-slate-700">
              <div className="w-16 h-16 rounded-xl bg-red-600/20 flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">For Volunteer Coaches</h3>
              <p className="text-slate-300 mb-6">
                You said yes to coaching the rec or travel team. Now you need practice plans that work, drills that keep kids engaged, and a way to track everyone&apos;s progress without losing your mind.
              </p>
              <ul className="space-y-3 text-slate-300">
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Manage full team rosters</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Create practice plans that keep everyone engaged</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Track progress for every player</span>
                </li>
              </ul>
            </div>

            <div className="bg-slate-800/50 rounded-2xl p-8 border border-slate-700">
              <div className="w-16 h-16 rounded-xl bg-red-600/20 flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">For Parents</h3>
              <p className="text-slate-300 mb-6">
                Your kid loves baseball, and you want to help them improve. But you need a structured approach—not just throwing the ball around in the backyard hoping something sticks.
              </p>
              <ul className="space-y-3 text-slate-300">
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Focus on your child&apos;s individual development</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Get progressive skill-building drills</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Track what&apos;s working and what needs work</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-slate-900 mb-6">
              Sound Familiar?
            </h2>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto">
              You said yes because you love baseball and want to help. But the reality hits fast.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
              <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Practice is in 2 hours...</h3>
              <p className="text-slate-600">
                And you have no idea what to work on. What drills are age-appropriate? How long should each take? Where do you even start with kids who can barely catch a pop fly?
              </p>
            </div>

            <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
              <div className="w-12 h-12 rounded-lg bg-orange-100 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">YouTube isn&apos;t cutting it</h3>
              <p className="text-slate-600">
                You spend hours watching random drill videos, but none of them fit your team&apos;s skill level. You&apos;re piecing things together and hoping it works.
              </p>
            </div>

            <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
              <div className="w-12 h-12 rounded-lg bg-yellow-100 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">No system for progress</h3>
              <p className="text-slate-600">
                Every practice feels like starting from scratch. You have no way to track what worked, what didn&apos;t, or how to build on last week&apos;s session.
              </p>
            </div>
          </div>

          <div className="mt-12 p-8 bg-gradient-to-br from-[#1a202c] to-slate-800 rounded-2xl text-center">
            <p className="text-xl text-slate-200 italic max-w-3xl mx-auto">
              &quot;I want to help my kid (or my team) get better, but I&apos;m terrified I&apos;m wasting their time—or worse, teaching them the wrong fundamentals.&quot;
            </p>
          </div>
        </div>
      </section>

      {/* Solution Section */}
      <section id="how-it-works" className="py-20 px-4 bg-gradient-to-br from-slate-50 to-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-slate-900 mb-6">
              What If You Had a Coaching Assistant Who Actually Gets It?
            </h2>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto">
              Bench Coach is like having an experienced coach in your pocket. One who knows your team (or your kid), remembers what you worked on last time, and helps you build skills week after week.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 items-center mb-16">
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center font-bold">1</div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Add Your Players</h3>
                  <p className="text-slate-600">Quick setup. Add your team roster or just your own child, their skill levels, and what you want them to work on.</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center font-bold">2</div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Get AI-Powered Practice Plans</h3>
                  <p className="text-slate-600">Tell Bench Coach what you want to focus on, and get a complete practice plan with age-appropriate drills, timing, and coaching tips.</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center font-bold">3</div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Track Progress &amp; Build Skills</h3>
                  <p className="text-slate-600">Take notes after practice. Bench Coach remembers what worked, what didn&apos;t, and adjusts future plans to build on your progress.</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center font-bold">4</div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Ask Questions Anytime</h3>
                  <p className="text-slate-600">Stuck on how to teach something? Not sure how to handle a specific situation? Ask the AI coach and get instant guidance based on your context.</p>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-2xl border-8 border-white shadow-2xl overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 min-h-[500px] flex items-center justify-center">
                <div className="text-center p-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <p className="text-slate-600 font-medium">AI Chat Preview</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Personal Story Section */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-slate-50 to-red-50 rounded-3xl p-12 border-2 border-red-100">
            <div className="flex items-start gap-6 mb-8">
              <div className="flex-shrink-0">
                <div className="w-20 h-20 rounded-full bg-slate-300 flex items-center justify-center text-2xl font-bold text-slate-700">
                  CW
                </div>
              </div>
              <div>
                <h2 className="text-3xl font-bold text-slate-900 mb-2">Why I Built This</h2>
                <p className="text-red-700 font-medium">— Clint, Founder</p>
              </div>
            </div>

            <div className="space-y-4 text-slate-700 leading-relaxed text-lg">
              <p>
                I played baseball through college. Coached high school teams. Spent years as an instructor at All Star Baseball Academy. I&apos;ve been around the game my whole life.
              </p>
              
              <p>
                But when I signed up to coach my 8-year-old son Charlie and his rec team? That was different.
              </p>

              <p>
                Six, seven, and eight-year-olds are... a lot. The attention spans are short. The skill levels are all over the place. And you&apos;re trying to keep twelve kids engaged while also teaching fundamentals and—oh yeah—making sure nobody gets hit in the face with a baseball.
              </p>

              <p>
                I&apos;d spend hours the night before practice searching for drills, trying to piece together a plan, worrying if I was even doing it right. And I had the advantage of actually knowing how to coach. I couldn&apos;t imagine what it was like for the other parent-coaches who&apos;d never played past Little League themselves.
              </p>

              <p>
                But here&apos;s the thing—I also wanted a better way to work with Charlie individually. Team practice is great, but as a parent, you want to help your own kid progress too. I needed something that could work for both: planning team practices AND tracking Charlie&apos;s personal development with drills we could do in the backyard.
              </p>

              <p>
                My day job is building software. So I thought: what if there was a tool that could help with this? Not some generic drill database, but something that actually understands your situation—whether that&apos;s a full team or just your own kid—and builds on what you worked on last time.
              </p>

              <p>
                I built Bench Coach for me first. To help with Charlie&apos;s team AND to help Charlie get better. To have a way to plan practices, track progress, and always have a next step ready to go.
              </p>

              <p>
                But then I realized—if this makes my life easier, it&apos;ll help every other parent and coach out there who&apos;s just trying to do right by their kids.
              </p>

              <p className="text-slate-900 font-semibold text-xl mt-6">
                You don&apos;t need to be an expert. You just need the right tools. Let me help you be the coach—or parent—your team or your child deserves.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid Section */}
      <section id="features" className="py-20 px-4 bg-gradient-to-br from-slate-50 to-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-slate-900 mb-6">
              Everything You Need to Coach with Confidence
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl p-6 border-2 border-slate-200 hover:border-red-300 transition-all hover:shadow-lg">
              <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Custom Practice Plans</h3>
              <p className="text-slate-600 text-sm">Generate complete practice plans in seconds based on your team&apos;s needs and skill level</p>
            </div>

            <div className="bg-white rounded-xl p-6 border-2 border-slate-200 hover:border-red-300 transition-all hover:shadow-lg">
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">AI Coaching Assistant</h3>
              <p className="text-slate-600 text-sm">Ask questions, get drill suggestions, and receive coaching advice tailored to your situation</p>
            </div>

            <div className="bg-white rounded-xl p-6 border-2 border-slate-200 hover:border-red-300 transition-all hover:shadow-lg">
              <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Team &amp; Player Management</h3>
              <p className="text-slate-600 text-sm">Track every player&apos;s progress, skills, and what they need to work on next</p>
            </div>

            <div className="bg-white rounded-xl p-6 border-2 border-slate-200 hover:border-red-300 transition-all hover:shadow-lg">
              <div className="w-12 h-12 rounded-lg bg-yellow-100 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Progressive Skill Building</h3>
              <p className="text-slate-600 text-sm">Create development playbooks that build skills systematically over weeks and months</p>
            </div>

            <div className="bg-white rounded-xl p-6 border-2 border-slate-200 hover:border-red-300 transition-all hover:shadow-lg">
              <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Practice Notes &amp; History</h3>
              <p className="text-slate-600 text-sm">Document what worked, what didn&apos;t, and build on your progress week after week</p>
            </div>

            <div className="bg-white rounded-xl p-6 border-2 border-slate-200 hover:border-red-300 transition-all hover:shadow-lg">
              <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Coaching Library</h3>
              <p className="text-slate-600 text-sm">Access guides on practice structure, parent communication, and age-appropriate fundamentals</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-slate-900 mb-6">
              Simple, Honest Pricing
            </h2>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto">
              No hidden fees. No per-player charges. Just one simple price to coach better.
            </p>
          </div>

          <div className="max-w-lg mx-auto">
            <div className="bg-gradient-to-br from-slate-50 to-white rounded-3xl border-4 border-red-600 overflow-hidden shadow-2xl">
              <div className="bg-red-600 text-white text-center py-4">
                <span className="text-sm font-semibold uppercase tracking-wide">Best Value</span>
              </div>
              
              <div className="p-12">
                <div className="text-center mb-8">
                  <div className="mb-4">
                    <span className="text-5xl font-bold text-slate-900">$10</span>
                    <span className="text-xl text-slate-600">/month</span>
                  </div>
                  <p className="text-slate-600">Everything you need to coach with confidence</p>
                </div>

                <ul className="space-y-4 mb-8">
                  <li className="flex items-start gap-3">
                    <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-slate-700">Unlimited practice plans</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-slate-700">AI coaching assistant</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-slate-700">Unlimited players &amp; teams</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-slate-700">Progress tracking &amp; notes</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-slate-700">Coaching library access</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-slate-700">Development playbooks</span>
                  </li>
                </ul>

                <Link href="/auth/signup" className="block w-full text-center px-8 py-4 text-lg font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-all shadow-lg mb-4">
                  Start Your Free Trial
                </Link>

                <p className="text-center text-sm text-slate-600">
                  14-day free trial • Cancel anytime
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-20 px-4 bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl lg:text-6xl font-bold text-white mb-6">
            Ready to Coach with Confidence?
          </h2>
          <p className="text-xl text-slate-300 mb-12 max-w-2xl mx-auto">
            Join the coaches who are spending less time stressing and more time actually coaching. Start your free trial today.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Link href="/auth/signup" className="inline-flex items-center justify-center px-10 py-5 text-xl font-bold text-slate-900 bg-red-400 rounded-lg hover:bg-red-300 transition-all hover:scale-105 shadow-2xl">
              Start Free Trial
              <svg className="ml-2 w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>

          <p className="text-slate-400 text-sm">
            14-day free trial • Cancel anytime
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-4 border-t border-slate-800">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-sm">&copy; 2025 Bench Coach. Built by coaches, for coaches and parents.</p>
        </div>
      </footer>
    </div>
  )
}
