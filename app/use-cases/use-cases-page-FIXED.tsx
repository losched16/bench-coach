import Link from 'next/link'
import Image from 'next/image'

export default function UseCasesPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Navigation Header */}
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
      <section className="relative bg-[#0f172a] py-20 px-6 text-center overflow-hidden">
        <div className="absolute top-[-200px] right-[-200px] w-[600px] h-[600px] bg-red-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-[-200px] left-[-200px] w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="inline-block bg-red-600/20 text-red-400 px-4 py-2 rounded-full text-sm font-semibold mb-6 border border-red-500/30">
            ⚾ Real Ways Real People Use BenchCoach
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight">
            See Yourself <span className="text-red-500">In Action</span>
          </h1>
          <p className="text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed">
            Practice plans, skill tracking, drill libraries, player journals, and AI coaching — here&apos;s exactly how BenchCoach fits into your routine.
          </p>
        </div>
      </section>

      {/* Persona Quick Nav */}
      <div className="max-w-7xl mx-auto px-6 -mt-12 relative z-20">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { emoji: '📋', label: 'Practice Plans', id: 'practice-plans' },
            { emoji: '📈', label: 'Player Development', id: 'player-dev' },
            { emoji: '👨‍👦', label: 'Parent at Home', id: 'parent-home' },
            { emoji: '🎯', label: 'Private Lessons', id: 'private-lessons' },
            { emoji: '🙋‍♂️', label: 'First-Time Coach', id: 'first-time' },
            { emoji: '🏆', label: 'Travel Ball', id: 'travel-ball' },
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
      </div>

      {/* Use Cases */}
      <div className="max-w-7xl mx-auto px-6 py-20">
        
        {/* Use Case 1: Practice Plans */}
        <section id="practice-plans" className="mb-24 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center text-3xl flex-shrink-0">📋</div>
            <div>
              <div className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-2">Coach</div>
              <h2 className="text-3xl font-bold text-slate-900">Generate Practice Plans in Seconds</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600">
                  &quot;Practice is in 2 hours and I have no plan. I don&apos;t have time to piece together YouTube videos and hope they work for my 8U team.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Mike, 8U Rec League Coach</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3">The Problem</h3>
              <p className="text-slate-600 mb-6">
                You&apos;re scrambling to find drills that fit your team&apos;s age and skill level. You waste 30 minutes Googling, another 20 minutes watching videos, and you still don&apos;t have a coherent plan.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3">How BenchCoach Helps</h3>
              <p className="text-slate-600 mb-4">
                Input your team&apos;s details once (age, skill level, practice length). Generate a complete, age-appropriate practice plan in 10 seconds. Save it, tweak it, or regenerate if you want something different.
              </p>
              
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Feature Path</div>
                <div className="flex flex-wrap gap-2 items-center text-sm">
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Dashboard</span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Practice Planner</span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Generate Plan</span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Save & Use</span>
                </div>
              </div>
            </div>

            <div className="bg-[#0f172a] rounded-2xl overflow-hidden shadow-2xl">
              <div className="bg-white/5 px-4 py-3 flex items-center gap-3 border-b border-white/10">
                <div className="flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                </div>
                <div className="text-slate-400 text-xs font-semibold">Practice Plan Generator</div>
                <div className="ml-auto bg-red-600/20 text-red-400 px-2 py-1 rounded-full text-[10px] font-bold">AI Powered</div>
              </div>
              <div className="p-4">
                <p className="text-slate-400 text-sm mb-4">Complete practice plan generated based on your team settings:</p>
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                  <h4 className="text-white font-bold mb-3 text-sm">90-Minute Practice: Catching & Throwing Fundamentals</h4>
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold rounded flex-shrink-0">10m</span>
                      <div>
                        <h5 className="text-white text-sm font-semibold">Warm-Up: Partner Catch</h5>
                        <p className="text-slate-400 text-xs">Start 15 feet apart, focus on &quot;alligator hands&quot; for receiving</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold rounded flex-shrink-0">20m</span>
                      <div>
                        <h5 className="text-white text-sm font-semibold">Station 1: Ground Balls</h5>
                        <p className="text-slate-400 text-xs">Roll, field, throw to coach. Max 4 kids per line.</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold rounded flex-shrink-0">20m</span>
                      <div>
                        <h5 className="text-white text-sm font-semibold">Station 2: Tee Hitting</h5>
                        <p className="text-slate-400 text-xs">Focus on contact, not power. 10 swings each.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 border-t border-white/10 flex flex-wrap gap-2">
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">Practice Planner</span>
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">AI Generation</span>
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">Team Settings</span>
              </div>
            </div>
          </div>
        </section>

        {/* Use Case 2: Player Development */}
        <section id="player-dev" className="mb-24 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center text-3xl flex-shrink-0">📈</div>
            <div>
              <div className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-2">Coach</div>
              <h2 className="text-3xl font-bold text-slate-900">Track Every Player&apos;s Progress</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600">
                  &quot;I have 12 kids on my team. I can&apos;t remember who&apos;s working on what, who&apos;s improving, and who needs extra help. I need a system.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Sarah, 10U Travel Coach</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3">The Problem</h3>
              <p className="text-slate-600 mb-6">
                You&apos;re trying to develop 12 different players at different speeds. You forget who struggled with fly balls last week. You can&apos;t show parents concrete progress.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3">How BenchCoach Helps</h3>
              <p className="text-slate-600 mb-4">
                Every player has a profile with skill ratings (1-5 scale). Track progress over time. Add notes after practice. The AI reads these notes and suggests targeted drills for each player.
              </p>
              
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Feature Path</div>
                <div className="flex flex-wrap gap-2 items-center text-sm">
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Dashboard</span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Team Roster</span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Player Profile</span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Update Skills</span>
                </div>
              </div>
            </div>

            <div className="bg-[#0f172a] rounded-2xl overflow-hidden shadow-2xl">
              <div className="bg-white/5 px-4 py-3 flex items-center gap-3 border-b border-white/10">
                <div className="flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                </div>
                <div className="text-slate-400 text-xs font-semibold">Player Profile: Jake Martinez</div>
              </div>
              <div className="p-4">
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 mb-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm">JM</div>
                    <div>
                      <h4 className="text-white font-bold text-sm">Jake Martinez</h4>
                      <p className="text-slate-400 text-xs">SS / 2B • Right-handed</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Catching:</span>
                      <div className="flex gap-1">
                        {[1,2,3,4].map(i => (
                          <div key={i} className="w-3 h-3 rounded-full bg-green-500"></div>
                        ))}
                        <div className="w-3 h-3 rounded-full border-2 border-slate-600"></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Throwing:</span>
                      <div className="flex gap-1">
                        {[1,2,3].map(i => (
                          <div key={i} className="w-3 h-3 rounded-full bg-amber-500"></div>
                        ))}
                        {[1,2].map(i => (
                          <div key={i} className="w-3 h-3 rounded-full border-2 border-slate-600"></div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                  <p className="text-slate-400 text-xs mb-2"><strong className="text-slate-300">Latest Note (3/15):</strong></p>
                  <p className="text-slate-300 text-xs">Struggled with balls hit to his backhand. Footwork needs work. Set up extra station next practice.</p>
                </div>
              </div>
              <div className="px-4 py-3 border-t border-white/10 flex flex-wrap gap-2">
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">Player Profiles</span>
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">Skill Ratings</span>
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">Progress Notes</span>
              </div>
            </div>
          </div>
        </section>

        {/* Use Case 3: Parent at Home */}
        <section id="parent-home" className="mb-24 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center text-3xl flex-shrink-0">👨‍👦</div>
            <div>
              <div className="text-sm font-bold text-green-600 uppercase tracking-wide mb-2">Parent</div>
              <h2 className="text-3xl font-bold text-slate-900">Work on Skills at Home</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600">
                  &quot;My son wants extra practice, but I don&apos;t know what to work on. I don&apos;t want to teach him bad habits.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Danielle, Mom of 9-Year-Old Player</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3">The Problem</h3>
              <p className="text-slate-600 mb-6">
                You want to help your kid improve, but you&apos;re not a coach. You don&apos;t know what drills are age-appropriate or how to structure 30-minute backyard sessions.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3">How BenchCoach Helps</h3>
              <p className="text-slate-600 mb-4">
                Add your child as a &quot;player.&quot; Get personalized drill recommendations based on their skill level. Track their progress just like a team coach would. All drills include video links and step-by-step instructions.
              </p>
              
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Feature Path</div>
                <div className="flex flex-wrap gap-2 items-center text-sm">
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Add Child</span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Set Skill Levels</span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Ask AI for Drills</span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg font-semibold text-slate-900">Save & Track</span>
                </div>
              </div>
            </div>

            <div className="bg-[#0f172a] rounded-2xl overflow-hidden shadow-2xl">
              <div className="bg-white/5 px-4 py-3 flex items-center gap-3 border-b border-white/10">
                <div className="flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                </div>
                <div className="text-slate-400 text-xs font-semibold">Chat with AI Coach</div>
              </div>
              <div className="p-4">
                <div className="space-y-3">
                  <div className="bg-red-600 text-white text-sm p-3 rounded-lg ml-auto max-w-[85%]">
                    My 9-year-old wants to work on hitting. We have 30 minutes in the backyard. What should we do?
                  </div>
                  <div className="bg-slate-700/50 text-slate-300 text-sm p-3 rounded-lg mr-auto max-w-[85%]">
                    Perfect! Here&apos;s a 30-minute hitting session for a 9-year-old:<br/><br/>
                    <strong className="text-white">Tee Work (15 min):</strong> Focus on &quot;load and explode.&quot; 20 swings total.<br/><br/>
                    <strong className="text-white">Soft Toss (10 min):</strong> You toss from the side. Focus on timing.<br/><br/>
                    <strong className="text-white">Cool Down (5 min):</strong> Light catch to end the session.
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 border-t border-white/10 flex flex-wrap gap-2">
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">AI Chat</span>
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">Individual Training</span>
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">Drill Library</span>
              </div>
            </div>
          </div>
        </section>

        {/* More use cases following same pattern... I'll add 2 more for space */}

        {/* Use Case 4: Private Lessons */}
        <section id="private-lessons" className="mb-24 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-purple-100 flex items-center justify-center text-3xl flex-shrink-0">🎯</div>
            <div>
              <div className="text-sm font-bold text-purple-600 uppercase tracking-wide mb-2">Coach + Business</div>
              <h2 className="text-3xl font-bold text-slate-900">Manage Private Lesson Students</h2>
            </div>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 border border-slate-200">
              <div className="border-l-4 border-red-500 pl-4 mb-6">
                <p className="text-lg italic text-slate-600">
                  &quot;I teach 15 private lesson students. I need to remember what each kid worked on last session and what we&apos;re building toward.&quot;
                </p>
                <p className="text-sm font-semibold text-slate-500 mt-3">— Tom, Private Hitting Instructor</p>
              </div>
              
              <h3 className="font-bold text-slate-900 mb-3">The Problem</h3>
              <p className="text-slate-600 mb-6">
                You&apos;re teaching multiple students per week. You can&apos;t remember who&apos;s working on what. Parents ask about progress and you&apos;re scrambling to recall.
              </p>
              
              <h3 className="font-bold text-slate-900 mb-3">How BenchCoach Helps</h3>
              <p className="text-slate-600">
                Each student gets a profile. After every lesson, add notes on what you worked on. Track skill progression over weeks/months. Pull up their profile before the lesson to remember exactly where you left off.
              </p>
            </div>

            <div className="bg-[#0f172a] rounded-2xl overflow-hidden shadow-2xl">
              <div className="bg-white/5 px-4 py-3 flex items-center gap-3 border-b border-white/10">
                <div className="flex gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                </div>
                <div className="text-slate-400 text-xs font-semibold">Student Roster</div>
              </div>
              <div className="p-4">
                <div className="space-y-2">
                  {['Emma S.', 'Noah P.', 'Sophia M.'].map((name, idx) => (
                    <div key={idx} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 flex items-center justify-between">
                      <div>
                        <h5 className="text-white text-sm font-semibold">{name}</h5>
                        <p className="text-slate-400 text-xs">Last session: 3 days ago</p>
                      </div>
                      <button className="px-3 py-1 bg-red-600/20 text-red-400 text-xs font-semibold rounded border border-red-500/30">
                        View Profile
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-4 py-3 border-t border-white/10 flex flex-wrap gap-2">
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">Student Management</span>
                <span className="bg-red-600/20 text-red-400 px-3 py-1 rounded-full text-xs font-semibold border border-red-500/30">Lesson Notes</span>
              </div>
            </div>
          </div>
        </section>

        {/* Use Case 5: First-Time Coach - Shortened for space */}
        <section id="first-time" className="mb-24 scroll-mt-24">
          <div className="flex items-start gap-6 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center text-3xl flex-shrink-0">🙋‍♂️</div>
            <div>
              <div className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-2">Coach</div>
              <h2 className="text-3xl font-bold text-slate-900">Coach Your First Team Ever</h2>
            </div>
          </div>
          
          <div className="bg-white rounded-2xl p-8 border border-slate-200 max-w-3xl">
            <div className="border-l-4 border-red-500 pl-4 mb-6">
              <p className="text-lg italic text-slate-600">
                &quot;I never played past Little League. I don&apos;t know the first thing about running a practice. But no other parents volunteered, so here I am.&quot;
              </p>
              <p className="text-sm font-semibold text-slate-500 mt-3">— Kevin, First-Time 6U Coach</p>
            </div>
            
            <p className="text-slate-600 mb-4">
              The AI coach walks you through everything step-by-step. Ask basic questions like &quot;What do I need for first practice?&quot; Get beginner-friendly explanations with no jargon. Generate practice plans designed for first-time coaches.
            </p>
          </div>
        </section>

      </div>

      {/* CTA */}
      <section className="bg-[#0f172a] py-20 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Ready to Coach Like This?
          </h2>
          <p className="text-xl text-slate-400 mb-8 leading-relaxed">
            Whether you&apos;re a first-time coach or a seasoned veteran, BenchCoach gives you the tools to plan better practices, develop players faster, and coach with confidence.
          </p>
          <Link 
            href="/auth/signup"
            className="inline-block px-10 py-5 bg-red-600 text-white text-lg font-bold rounded-lg hover:bg-red-700 transition-all hover:scale-105 shadow-2xl"
          >
            Start Your Free Trial →
          </Link>
          <p className="text-slate-500 text-sm mt-6">
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
