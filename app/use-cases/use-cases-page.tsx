import Link from 'next/link'
import Image from 'next/image'

export default function UseCasesPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Navigation Header - Same as homepage */}
      <header className="sticky top-0 z-50 bg-[#1a202c] border-b border-slate-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <Image src="/Bench_Coach_Logo.png" alt="BenchCoach" width={180} height={48} className="h-12 w-auto" />
            </Link>
            
            <nav className="hidden md:flex items-center gap-8">
              <a href="/#features" className="text-slate-300 hover:text-white font-medium transition-colors">Features</a>
              <a href="/#how-it-works" className="text-slate-300 hover:text-white font-medium transition-colors">How It Works</a>
              <Link href="/use-cases" className="text-white font-medium transition-colors">Use Cases</Link>
              <a href="/#pricing" className="text-slate-300 hover:text-white font-medium transition-colors">Pricing</a>
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

      {/* Hero */}
      <section className="bg-[#1a202c] py-20 px-4 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-block px-4 py-2 rounded-full bg-red-500/10 border border-red-500/20 mb-6">
            <span className="text-sm font-semibold text-red-400">Real Coaches. Real Parents. Real Scenarios.</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6">
            How People Actually Use <span className="text-red-500">BenchCoach</span>
          </h1>
          <p className="text-xl text-slate-300 max-w-3xl mx-auto">
            From rec league volunteers to travel ball coaches to parents working one-on-one with their kids — here&apos;s how BenchCoach helps real people coach better.
          </p>
        </div>
      </section>

      {/* Persona Cards Navigation */}
      <section className="max-w-7xl mx-auto px-4 -mt-12 mb-16">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { emoji: '⚾', label: 'Rec League Coach', id: 'rec-league' },
            { emoji: '🙋‍♂️', label: 'First-Time Coach', id: 'first-time' },
            { emoji: '👨‍👦', label: 'Parent Trainer', id: 'parent-trainer' },
            { emoji: '⏰', label: 'Busy Parent', id: 'working-parent' },
            { emoji: '👨‍👩‍👧‍👦', label: 'Multi-Kid Parent', id: 'sibling-juggler' },
            { emoji: '🏆', label: 'Travel Ball Coach', id: 'travel-ball' },
            { emoji: '🤝', label: 'Assistant Coach', id: 'assistant' },
          ].map((persona) => (
            <a
              key={persona.id}
              href={`#${persona.id}`}
              className="bg-white rounded-xl p-4 text-center hover:shadow-lg hover:-translate-y-1 transition-all border-2 border-slate-200 hover:border-red-400"
            >
              <div className="text-3xl mb-2">{persona.emoji}</div>
              <div className="text-xs font-semibold text-slate-700 leading-tight">{persona.label}</div>
            </a>
          ))}
        </div>
      </section>

      {/* Use Cases */}
      <div className="max-w-7xl mx-auto px-4 pb-20">
        
        {/* Use Case 1: Rec League */}
        <section id="rec-league" className="mb-24 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center text-3xl flex-shrink-0">⚾</div>
            <div>
              <div className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-2">Coach</div>
              <h2 className="text-3xl font-bold text-slate-900">Run Organized Rec League Practices</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600">
                  &quot;I volunteered to coach my son&apos;s 8U rec team. I played baseball growing up, but I&apos;ve never actually planned a practice before. I don&apos;t know how to structure 90 minutes with 12 kids who&apos;ve never played.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Mike, First Year 8U Rec Coach</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3">The Problem</h3>
              <p className="text-slate-600 mb-6">
                You said yes because you love baseball and want to help, but you have no clue how to fill 90 minutes with productive drills that keep 8-year-olds engaged. Google gives you random YouTube videos. You&apos;re winging it and hoping for the best.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3">How BenchCoach Helps</h3>
              <p className="text-slate-600">
                Tell BenchCoach your team&apos;s age, skill level, and practice length. The AI builds a complete practice plan with warm-ups, station rotations, and timing for each drill. Ask follow-up questions like &quot;How do I teach kids to catch fly balls?&quot; and get age-appropriate coaching tips instantly.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-gradient-to-r from-[#1a202c] to-slate-700 px-6 py-3 flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse"></div>
                <span className="text-sm font-semibold text-white">BenchCoach AI</span>
              </div>
              <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto">
                <div className="bg-slate-100 rounded-2xl p-4 ml-auto max-w-[85%]">
                  <p className="text-sm text-slate-800">I need a 90-minute practice plan for 8U beginners. Most kids can&apos;t catch or throw accurately yet.</p>
                </div>
                <div className="bg-blue-50 rounded-2xl p-4 mr-auto max-w-[85%] border border-blue-200">
                  <p className="text-sm text-slate-800">
                    Got it — here&apos;s a plan focused on <strong className="text-blue-700">basic catching, throwing mechanics, and keeping things moving</strong> so no one gets bored:
                    <br/><br/>
                    <strong className="text-blue-700">Warm-Up (10 min)</strong> — Partner catch from 15 feet, focusing on &quot;alligator hands&quot; for receiving.
                    <br/><br/>
                    <strong className="text-blue-700">Station 1: Ground Balls (20 min)</strong> — Roll ball, field it, throw to coach. Keep lines short (max 4 kids per line).
                    <br/><br/>
                    <strong className="text-blue-700">Station 2: Tee Hitting (20 min)</strong> — Focus on contact, not power...
                  </p>
                </div>
                <div className="bg-slate-100 rounded-2xl p-4 ml-auto max-w-[85%]">
                  <p className="text-sm text-slate-800">What if some kids are more advanced?</p>
                </div>
                <div className="bg-blue-50 rounded-2xl p-4 mr-auto max-w-[85%] border border-blue-200">
                  <p className="text-sm text-slate-800">
                    Great question. For advanced kids in Station 1, have them field real grounders (not rolls) and throw to first base instead of the coach. In Station 2, move them off the tee and use soft-toss. This keeps everyone challenged without splitting your attention.
                  </p>
                </div>
              </div>
              <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">AI Chat</span>
                <span className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">Practice Plans</span>
                <span className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">Age-Appropriate</span>
              </div>
            </div>
          </div>
        </section>

        {/* Use Case 2: First-Time Coach */}
        <section id="first-time" className="mb-24 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center text-3xl flex-shrink-0">🙋‍♂️</div>
            <div>
              <div className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-2">Coach</div>
              <h2 className="text-3xl font-bold text-slate-900">Coach Your First Team Ever</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600">
                  &quot;I never played organized baseball past Little League. My daughter wanted to play, and no other parents volunteered. Now I&apos;m the coach and I have no idea what I&apos;m doing. I don&apos;t even know what drills exist.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Sarah, First-Time 6U Coach</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3">The Problem</h3>
              <p className="text-slate-600 mb-6">
                You&apos;re not just new to coaching — you&apos;re new to baseball itself. You don&apos;t know the terminology, the progression of skills, or even what equipment you need. Parents are looking to you for leadership and you feel like a fraud.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3">How BenchCoach Helps</h3>
              <p className="text-slate-600">
                BenchCoach is built for people who&apos;ve never coached before. The AI explains everything in plain English — no jargon. It walks you through practice structure, what drills to use, how to set them up, and what to say to kids. Think of it as a coaching mentor in your pocket.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-gradient-to-r from-[#1a202c] to-slate-700 px-6 py-3 flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse"></div>
                <span className="text-sm font-semibold text-white">BenchCoach AI</span>
              </div>
              <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto">
                <div className="bg-slate-100 rounded-2xl p-4 ml-auto max-w-[85%]">
                  <p className="text-sm text-slate-800">I&apos;ve never coached before. What do I even need to bring to the first practice?</p>
                </div>
                <div className="bg-blue-50 rounded-2xl p-4 mr-auto max-w-[85%] border border-blue-200">
                  <p className="text-sm text-slate-800">
                    Let&apos;s start with the essentials:
                    <br/><br/>
                    <strong className="text-blue-700">Equipment You Need:</strong><br/>
                    • Bucket of baseballs (bring 2 dozen if you have them)<br/>
                    • Batting tee (ask if the league has one)<br/>
                    • Cones for marking stations<br/>
                    • First aid kit<br/><br/>
                    <strong className="text-blue-700">Nice to Have:</strong><br/>
                    • Clipboard for roster/notes<br/>
                    • Whistle (helps get attention)<br/><br/>
                    Don&apos;t overthink it. Most rec leagues provide bases, helmets, and bats. Focus on showing up with a plan and a positive attitude — that&apos;s 90% of it.
                  </p>
                </div>
              </div>
              <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">Beginner-Friendly</span>
                <span className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">AI Coaching Tips</span>
                <span className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">Practice Plans</span>
              </div>
            </div>
          </div>
        </section>

        {/* Use Case 3: Parent Trainer */}
        <section id="parent-trainer" className="mb-24 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-100 to-pink-200 flex items-center justify-center text-3xl flex-shrink-0">👨‍👦</div>
            <div>
              <div className="text-sm font-bold text-pink-600 uppercase tracking-wide mb-2">Parent</div>
              <h2 className="text-3xl font-bold text-slate-900">Train Your Own Kid at Home</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600">
                  &quot;My son loves baseball and wants to get better, but team practice is only twice a week. I want to work with him in the backyard, but I don&apos;t know what drills to do or how to teach proper mechanics.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Tom, Dad of 10-Year-Old Travel Ball Player</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3">The Problem</h3>
              <p className="text-slate-600 mb-6">
                Your kid is motivated, but you don&apos;t want to accidentally teach bad habits. You need a structured plan that builds on itself week after week. You also need drills that work with limited space and equipment (just you, your kid, and a backyard).
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3">How BenchCoach Helps</h3>
              <p className="text-slate-600">
                BenchCoach creates custom training plans for individual players. Tell it what your kid is working on (hitting, fielding, speed, etc.) and it builds progressive sessions you can do at home. Track your kid&apos;s progress over time and adjust focus areas as they improve.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="bg-gradient-to-r from-[#1a202c] to-slate-700 px-6 py-3 flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse"></div>
                <span className="text-sm font-semibold text-white">BenchCoach AI</span>
              </div>
              <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto">
                <div className="bg-slate-100 rounded-2xl p-4 ml-auto max-w-[85%]">
                  <p className="text-sm text-slate-800">My 10-year-old wants to work on hitting. We have 30 minutes after school 3 days a week. What should we do?</p>
                </div>
                <div className="bg-blue-50 rounded-2xl p-4 mr-auto max-w-[85%] border border-blue-200">
                  <p className="text-sm text-slate-800">
                    Perfect — consistent 30-minute sessions are ideal for skill-building. Here&apos;s a <strong className="text-blue-700">3-week hitting progression</strong> you can start today:
                    <br/><br/>
                    <strong className="text-blue-700">Week 1: Tee Work (Load & Contact)</strong><br/>
                    • 10 min: Basic tee swings focusing on &quot;load and explode&quot;<br/>
                    • 10 min: Inside/outside pitch locations<br/>
                    • 10 min: Tracking drill...
                  </p>
                </div>
                <div className="bg-slate-100 rounded-2xl p-4 ml-auto max-w-[85%]">
                  <p className="text-sm text-slate-800">He struggles with keeping his front shoulder closed. How do I fix that?</p>
                </div>
                <div className="bg-blue-50 rounded-2xl p-4 mr-auto max-w-[85%] border border-blue-200">
                  <p className="text-sm text-slate-800">
                    Great catch — that&apos;s super common. Try this drill: Have him hold a bat across his chest with both hands (like a hug). As you soft toss, he rotates his torso WITHOUT swinging. This isolates hip rotation and keeps the shoulder from flying open. Do 10 reps before each tee session.
                  </p>
                </div>
              </div>
              <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">Individual Training</span>
                <span className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">Progression Plans</span>
                <span className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">Progress Tracking</span>
              </div>
            </div>
          </div>
        </section>

        {/* Add more use cases following the same pattern... */}
        {/* I'm including 3 examples - you can add the rest following this pattern */}

      </div>

      {/* CTA Section */}
      <section className="bg-[#1a202c] py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Which One Sounds Like You?
          </h2>
          <p className="text-xl text-slate-300 mb-10">
            Whether you&apos;re a seasoned travel ball coach or a parent learning alongside your kid, BenchCoach meets you where you are.
          </p>
          <Link 
            href="/auth/signup"
            className="inline-block px-10 py-5 bg-red-600 text-white text-lg font-bold rounded-lg hover:bg-red-700 transition-all hover:scale-105 shadow-2xl"
          >
            Start Your Free Trial →
          </Link>
          <p className="text-slate-400 text-sm mt-6">
            $10/month after trial • Unlimited assistant coaches included
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-4 border-t border-slate-800">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="text-white font-bold mb-4">BenchCoach</h3>
              <p className="text-sm">AI-powered coaching tools for youth baseball coaches and parents.</p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/#features" className="hover:text-white transition-colors">Features</a></li>
                <li><Link href="/use-cases" className="hover:text-white transition-colors">Use Cases</Link></li>
                <li><a href="/#pricing" className="hover:text-white transition-colors">Pricing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/about" className="hover:text-white transition-colors">About</a></li>
                <li><a href="/contact" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/privacy" className="hover:text-white transition-colors">Privacy</a></li>
                <li><a href="/terms" className="hover:text-white transition-colors">Terms</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 text-center text-sm">
            © 2026 BenchCoach. Built by a coach, for coaches and parents.
          </div>
        </div>
      </footer>
    </div>
  )
}
