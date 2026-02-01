import Link from 'next/link'
import Image from 'next/image'

export default function UseCasesPage() {
  return (
    <>
      <style jsx>{`
        /* DM Sans & Outfit fonts are already loaded in your app */
        
        .hero {
          background: #0f172a;
          padding: 80px 24px 100px;
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        
        .hero::before {
          content: '';
          position: absolute;
          top: -200px;
          right: -200px;
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, rgba(233,69,96,0.08) 0%, transparent 70%);
          pointer-events: none;
        }
        
        .hero::after {
          content: '';
          position: absolute;
          bottom: -200px;
          left: -200px;
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%);
          pointer-events: none;
        }
        
        .hero-inner {
          max-width: 800px;
          margin: 0 auto;
          position: relative;
          z-index: 1;
        }
        
        .hero-badge {
          display: inline-block;
          background: rgba(233,69,96,0.12);
          color: #e94560;
          padding: 6px 16px;
          border-radius: 100px;
          font-size: 0.85rem;
          font-weight: 600;
          margin-bottom: 24px;
          border: 1px solid rgba(233,69,96,0.2);
        }
        
        .hero h1 {
          font-family: 'Outfit', sans-serif;
          font-size: clamp(2.2rem, 5vw, 3.4rem);
          font-weight: 800;
          color: white;
          line-height: 1.15;
          margin-bottom: 20px;
          letter-spacing: -1px;
        }
        
        .hero h1 em {
          font-style: normal;
          color: #e94560;
        }
        
        .hero p {
          font-size: 1.15rem;
          color: #94a3b8;
          max-width: 620px;
          margin: 0 auto;
          line-height: 1.7;
        }
        
        .personas-nav {
          max-width: 1200px;
          margin: -50px auto 0;
          padding: 0 24px;
          position: relative;
          z-index: 2;
        }
        
        .personas-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 12px;
        }
        
        .persona-tab {
          background: white;
          border: 2px solid #e2e8f0;
          border-radius: 12px;
          padding: 16px 12px;
          text-align: center;
          cursor: pointer;
          transition: all 0.25s;
          text-decoration: none;
          color: #0f172a;
        }
        
        .persona-tab:hover {
          border-color: #e94560;
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(233,69,96,0.12);
        }
        
        .persona-tab .emoji {
          font-size: 1.8rem;
          display: block;
          margin-bottom: 8px;
        }
        
        .persona-tab .label {
          font-size: 0.82rem;
          font-weight: 600;
          line-height: 1.3;
          color: #334155;
        }
        
        .use-cases {
          max-width: 1200px;
          margin: 0 auto;
          padding: 60px 24px 80px;
        }
        
        .use-case {
          margin-bottom: 80px;
          scroll-margin-top: 100px;
        }
        
        .use-case:last-child {
          margin-bottom: 0;
        }
        
        .use-case-header {
          display: flex;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 32px;
        }
        
        .use-case-icon {
          width: 64px;
          height: 64px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.8rem;
          flex-shrink: 0;
        }
        
        .use-case-header h2 {
          font-family: 'Outfit', sans-serif;
          font-size: 1.8rem;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.5px;
          line-height: 1.2;
        }
        
        .use-case-header .persona-type {
          font-size: 0.85rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 4px;
        }
        
        .use-case-body {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
          align-items: start;
        }
        
        @media (max-width: 768px) {
          .use-case-body {
            grid-template-columns: 1fr;
          }
        }
        
        .story {
          background: white;
          border-radius: 16px;
          padding: 32px;
          border: 1px solid #e2e8f0;
        }
        
        .story-quote {
          font-size: 1.05rem;
          color: #475569;
          font-style: italic;
          line-height: 1.7;
          margin-bottom: 16px;
          padding-left: 16px;
          border-left: 3px solid #e94560;
        }
        
        .story-persona {
          font-size: 0.85rem;
          color: #64748b;
          font-weight: 500;
          margin-bottom: 24px;
        }
        
        .story h3 {
          font-family: 'Outfit', sans-serif;
          font-size: 1.15rem;
          font-weight: 700;
          color: #0f172a;
          margin: 24px 0 12px;
        }
        
        .story h3:first-of-type {
          margin-top: 0;
        }
        
        .story p {
          color: #475569;
          font-size: 0.95rem;
          line-height: 1.7;
        }
        
        .feature-path {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 16px;
          margin-top: 16px;
        }
        
        .feature-path-title {
          font-size: 0.8rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: #94a3b8;
          margin-bottom: 10px;
        }
        
        .feature-path-steps {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }
        
        .fp-step {
          background: white;
          border: 1px solid #e2e8f0;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 0.82rem;
          font-weight: 600;
          color: #0f172a;
          white-space: nowrap;
        }
        
        .fp-arrow {
          color: #cbd5e1;
          font-size: 0.85rem;
        }
        
        .app-preview {
          background: #0f172a;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 16px 48px rgba(15,23,42,0.25);
        }
        
        .app-bar {
          background: rgba(255,255,255,0.05);
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        
        .app-dots {
          display: flex;
          gap: 6px;
        }
        
        .app-dots span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        
        .app-dots span:nth-child(1) {
          background: #ef4444;
        }
        
        .app-dots span:nth-child(2) {
          background: #f59e0b;
        }
        
        .app-dots span:nth-child(3) {
          background: #22c55e;
        }
        
        .app-bar-title {
          color: #94a3b8;
          font-size: 0.8rem;
          font-weight: 600;
          letter-spacing: 0.5px;
        }
        
        .app-bar-badge {
          margin-left: auto;
          background: rgba(233,69,96,0.15);
          color: #e94560;
          padding: 3px 10px;
          border-radius: 100px;
          font-size: 0.7rem;
          font-weight: 600;
        }
        
        .app-content {
          padding: 16px;
        }
        
        .features-used {
          padding: 12px 16px;
          border-top: 1px solid rgba(255,255,255,0.06);
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        
        .feature-pill {
          background: rgba(255,255,255,0.06);
          color: #94a3b8;
          padding: 5px 12px;
          border-radius: 100px;
          font-size: 0.72rem;
          font-weight: 500;
          border: 1px solid rgba(255,255,255,0.08);
        }
        
        .feature-pill.active {
          background: rgba(233,69,96,0.15);
          color: #e94560;
          border-color: rgba(233,69,96,0.3);
        }
        
        .icon-coach {
          background: rgba(59,130,246,0.1);
        }
        
        .icon-parent {
          background: rgba(34,197,94,0.1);
        }
        
        .icon-both {
          background: rgba(139,92,246,0.1);
        }
        
        .label-coach {
          color: #3b82f6;
        }
        
        .label-parent {
          color: #22c55e;
        }
        
        .label-both {
          color: #8b5cf6;
        }
        
        .cta-section {
          background: #0f172a;
          padding: 80px 24px;
          text-align: center;
        }
        
        .cta-inner {
          max-width: 600px;
          margin: 0 auto;
        }
        
        .cta-section h2 {
          font-family: 'Outfit', sans-serif;
          font-size: clamp(1.8rem, 4vw, 2.4rem);
          font-weight: 800;
          color: white;
          margin-bottom: 16px;
          letter-spacing: -0.5px;
        }
        
        .cta-section p {
          color: #94a3b8;
          font-size: 1.05rem;
          margin-bottom: 32px;
          line-height: 1.7;
        }
        
        .cta-btn {
          display: inline-block;
          background: #e94560;
          color: white;
          padding: 16px 40px;
          border-radius: 12px;
          text-decoration: none;
          font-weight: 700;
          font-size: 1.05rem;
          transition: all 0.25s;
          box-shadow: 0 4px 16px rgba(233,69,96,0.3);
        }
        
        .cta-btn:hover {
          background: #c73650;
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(233,69,96,0.4);
        }
        
        .cta-sub {
          margin-top: 16px;
          font-size: 0.85rem;
          color: #64748b;
        }
      `}</style>

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
        <section className="hero">
          <div className="hero-inner">
            <div className="hero-badge">⚾ Real Ways Real People Use BenchCoach</div>
            <h1>See Yourself <em>In Action</em></h1>
            <p>Practice plans, skill tracking, drill libraries, player journals, and AI coaching — here&apos;s exactly how BenchCoach fits into your routine.</p>
          </div>
        </section>

        {/* Persona Quick Nav */}
        <div className="personas-nav">
          <div className="personas-grid">
            <a href="#practice-plans" className="persona-tab">
              <span className="emoji">📋</span>
              <span className="label">Practice Plans</span>
            </a>
            <a href="#player-dev" className="persona-tab">
              <span className="emoji">📈</span>
              <span className="label">Player Development</span>
            </a>
            <a href="#parent-home" className="persona-tab">
              <span className="emoji">👨‍👦</span>
              <span className="label">Parent at Home</span>
            </a>
            <a href="#private-lessons" className="persona-tab">
              <span className="emoji">🎯</span>
              <span className="label">Private Lessons</span>
            </a>
            <a href="#first-time" className="persona-tab">
              <span className="emoji">🙋‍♂️</span>
              <span className="label">First-Time Coach</span>
            </a>
            <a href="#travel-ball" className="persona-tab">
              <span className="emoji">🏆</span>
              <span className="label">Travel Ball</span>
            </a>
            <a href="#assistant" className="persona-tab">
              <span className="emoji">🤝</span>
              <span className="label">Assistant Coach</span>
            </a>
          </div>
        </div>

        {/* Use Cases */}
        <div className="use-cases">
          {/* Use Case 1: Practice Plans */}
          <section id="practice-plans" className="use-case">
            <div className="use-case-header">
              <div className="use-case-icon icon-coach">📋</div>
              <div>
                <div className="persona-type label-coach">Coach</div>
                <h2>Generate Practice Plans in Seconds</h2>
              </div>
            </div>
            <div className="use-case-body">
              <div className="story">
                <div className="story-quote">
                  &quot;Practice is in 2 hours and I have no plan. I don&apos;t have time to piece together YouTube videos and hope they work for my 8U team.&quot;
                </div>
                <div className="story-persona">— Mike, 8U Rec League Coach</div>
                <h3>The Problem</h3>
                <p>
                  You&apos;re scrambling to find drills that fit your team&apos;s age and skill level. You waste 30 minutes Googling, another 20 minutes watching videos, and you still don&apos;t have a coherent plan.
                </p>
                <h3>How BenchCoach Helps</h3>
                <p>
                  Input your team&apos;s details once (age, skill level, practice length). Generate a complete, age-appropriate practice plan in 10 seconds. Save it, tweak it, or regenerate if you want something different.
                </p>
                <div className="feature-path">
                  <div className="feature-path-title">Feature Path</div>
                  <div className="feature-path-steps">
                    <span className="fp-step">Dashboard</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Practice Planner</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Generate Plan</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Save & Use</span>
                  </div>
                </div>
              </div>

              <div className="app-preview">
                <div className="app-bar">
                  <div className="app-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div className="app-bar-title">Practice Plan Generator</div>
                  <div className="app-bar-badge">AI Powered</div>
                </div>
                <div className="app-content">
                  <p className="text-slate-400 text-sm mb-4">Complete practice plan generated based on your team settings:</p>
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <h4 className="text-white font-bold mb-2">90-Minute Practice: Catching & Throwing Fundamentals</h4>
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold rounded">10m</span>
                        <div>
                          <h5 className="text-white text-sm font-semibold">Warm-Up: Partner Catch</h5>
                          <p className="text-slate-400 text-xs">Start 15 feet apart, focus on &quot;alligator hands&quot; for receiving</p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold rounded">20m</span>
                        <div>
                          <h5 className="text-white text-sm font-semibold">Station 1: Ground Balls</h5>
                          <p className="text-slate-400 text-xs">Roll, field, throw to coach. Max 4 kids per line.</p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold rounded">20m</span>
                        <div>
                          <h5 className="text-white text-sm font-semibold">Station 2: Tee Hitting</h5>
                          <p className="text-slate-400 text-xs">Focus on contact, not power. 10 swings each.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="features-used">
                  <span className="feature-pill active">Practice Planner</span>
                  <span className="feature-pill active">AI Generation</span>
                  <span className="feature-pill active">Team Settings</span>
                </div>
              </div>
            </div>
          </section>

          {/* Use Case 2: Player Development */}
          <section id="player-dev" className="use-case">
            <div className="use-case-header">
              <div className="use-case-icon icon-coach">📈</div>
              <div>
                <div className="persona-type label-coach">Coach</div>
                <h2>Track Every Player&apos;s Progress</h2>
              </div>
            </div>
            <div className="use-case-body">
              <div className="story">
                <div className="story-quote">
                  &quot;I have 12 kids on my team. I can&apos;t remember who&apos;s working on what, who&apos;s improving, and who needs extra help. I need a system.&quot;
                </div>
                <div className="story-persona">— Sarah, 10U Travel Coach</div>
                <h3>The Problem</h3>
                <p>
                  You&apos;re trying to develop 12 different players at different speeds. You forget who struggled with fly balls last week. You can&apos;t show parents concrete progress.
                </p>
                <h3>How BenchCoach Helps</h3>
                <p>
                  Every player has a profile with skill ratings (1-5 scale). Track progress over time. Add notes after practice. The AI reads these notes and suggests targeted drills for each player.
                </p>
                <div className="feature-path">
                  <div className="feature-path-title">Feature Path</div>
                  <div className="feature-path-steps">
                    <span className="fp-step">Dashboard</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Team Roster</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Player Profile</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Update Skills</span>
                  </div>
                </div>
              </div>

              <div className="app-preview">
                <div className="app-bar">
                  <div className="app-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div className="app-bar-title">Player Profile: Jake Martinez</div>
                </div>
                <div className="app-content">
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 mb-4">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold">JM</div>
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
                <div className="features-used">
                  <span className="feature-pill active">Player Profiles</span>
                  <span className="feature-pill active">Skill Ratings</span>
                  <span className="feature-pill active">Progress Notes</span>
                </div>
              </div>
            </div>
          </section>

          {/* Use Case 3: Parent at Home */}
          <section id="parent-home" className="use-case">
            <div className="use-case-header">
              <div className="use-case-icon icon-parent">👨‍👦</div>
              <div>
                <div className="persona-type label-parent">Parent</div>
                <h2>Work on Skills at Home</h2>
              </div>
            </div>
            <div className="use-case-body">
              <div className="story">
                <div className="story-quote">
                  &quot;My son wants extra practice, but I don&apos;t know what to work on. I don&apos;t want to teach him bad habits.&quot;
                </div>
                <div className="story-persona">— Danielle, Mom of 9-Year-Old Player</div>
                <h3>The Problem</h3>
                <p>
                  You want to help your kid improve, but you&apos;re not a coach. You don&apos;t know what drills are age-appropriate or how to structure 30-minute backyard sessions.
                </p>
                <h3>How BenchCoach Helps</h3>
                <p>
                  Add your child as a &quot;player.&quot; Get personalized drill recommendations based on their skill level. Track their progress just like a team coach would. All drills include video links and step-by-step instructions.
                </p>
                <div className="feature-path">
                  <div className="feature-path-title">Feature Path</div>
                  <div className="feature-path-steps">
                    <span className="fp-step">Add Child</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Set Skill Levels</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Ask AI for Drills</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Save & Track</span>
                  </div>
                </div>
              </div>

              <div className="app-preview">
                <div className="app-bar">
                  <div className="app-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div className="app-bar-title">Chat with AI Coach</div>
                </div>
                <div className="app-content">
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
                <div className="features-used">
                  <span className="feature-pill active">AI Chat</span>
                  <span className="feature-pill active">Individual Training</span>
                  <span className="feature-pill active">Drill Library</span>
                </div>
              </div>
            </div>
          </section>

          {/* Use Case 4: Private Lessons */}
          <section id="private-lessons" className="use-case">
            <div className="use-case-header">
              <div className="use-case-icon icon-both">🎯</div>
              <div>
                <div className="persona-type label-both">Coach + Business</div>
                <h2>Manage Private Lesson Students</h2>
              </div>
            </div>
            <div className="use-case-body">
              <div className="story">
                <div className="story-quote">
                  &quot;I teach 15 private lesson students. I need to remember what each kid worked on last session and what we&apos;re building toward.&quot;
                </div>
                <div className="story-persona">— Tom, Private Hitting Instructor</div>
                <h3>The Problem</h3>
                <p>
                  You&apos;re teaching multiple students per week. You can&apos;t remember who&apos;s working on what. Parents ask about progress and you&apos;re scrambling to recall.
                </p>
                <h3>How BenchCoach Helps</h3>
                <p>
                  Each student gets a profile. After every lesson, add notes on what you worked on. Track skill progression over weeks/months. Pull up their profile before the lesson to remember exactly where you left off.
                </p>
                <div className="feature-path">
                  <div className="feature-path-title">Feature Path</div>
                  <div className="feature-path-steps">
                    <span className="fp-step">Add Students</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Lesson Notes</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Progress Tracking</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Parent Reports</span>
                  </div>
                </div>
              </div>

              <div className="app-preview">
                <div className="app-bar">
                  <div className="app-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div className="app-bar-title">Student Roster</div>
                </div>
                <div className="app-content">
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
                <div className="features-used">
                  <span className="feature-pill active">Student Management</span>
                  <span className="feature-pill active">Lesson Notes</span>
                  <span className="feature-pill active">Progress Reports</span>
                </div>
              </div>
            </div>
          </section>

          {/* Use Case 5: First-Time Coach */}
          <section id="first-time" className="use-case">
            <div className="use-case-header">
              <div className="use-case-icon icon-coach">🙋‍♂️</div>
              <div>
                <div className="persona-type label-coach">Coach</div>
                <h2>Coach Your First Team Ever</h2>
              </div>
            </div>
            <div className="use-case-body">
              <div className="story">
                <div className="story-quote">
                  &quot;I never played past Little League. I don&apos;t know the first thing about running a practice. But no other parents volunteered, so here I am.&quot;
                </div>
                <div className="story-persona">— Kevin, First-Time 6U Coach</div>
                <h3>The Problem</h3>
                <p>
                  You&apos;re completely new to coaching. You don&apos;t know what equipment you need, how to structure practice, or even what drills exist. You&apos;re terrified of looking foolish in front of parents.
                </p>
                <h3>How BenchCoach Helps</h3>
                <p>
                  The AI coach walks you through everything step-by-step. Ask basic questions like &quot;What do I need for first practice?&quot; Get beginner-friendly explanations with no jargon. Generate practice plans designed for first-time coaches.
                </p>
                <div className="feature-path">
                  <div className="feature-path-title">Feature Path</div>
                  <div className="feature-path-steps">
                    <span className="fp-step">Onboarding</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Setup Team</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Ask AI Coach</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">First Practice Plan</span>
                  </div>
                </div>
              </div>

              <div className="app-preview">
                <div className="app-bar">
                  <div className="app-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div className="app-bar-title">Chat with AI Coach</div>
                </div>
                <div className="app-content">
                  <div className="space-y-3">
                    <div className="bg-red-600 text-white text-sm p-3 rounded-lg ml-auto max-w-[85%]">
                      I&apos;ve never coached before. What do I need to bring to the first practice?
                    </div>
                    <div className="bg-slate-700/50 text-slate-300 text-sm p-3 rounded-lg mr-auto max-w-[85%]">
                      Let&apos;s start with the essentials:<br/><br/>
                      <strong className="text-white">Equipment You Need:</strong><br/>
                      • Bucket of baseballs (2 dozen)<br/>
                      • Batting tee<br/>
                      • Cones for stations<br/>
                      • First aid kit<br/><br/>
                      Most leagues provide bases, helmets, and bats. Focus on showing up with a plan and a positive attitude — that&apos;s 90% of it!
                    </div>
                  </div>
                </div>
                <div className="features-used">
                  <span className="feature-pill active">Beginner Guidance</span>
                  <span className="feature-pill active">AI Chat</span>
                  <span className="feature-pill active">Practice Plans</span>
                </div>
              </div>
            </div>
          </section>

          {/* Use Case 6: Travel Ball */}
          <section id="travel-ball" className="use-case">
            <div className="use-case-header">
              <div className="use-case-icon icon-coach">🏆</div>
              <div>
                <div className="persona-type label-coach">Coach</div>
                <h2>Manage a Competitive Travel Team</h2>
              </div>
            </div>
            <div className="use-case-body">
              <div className="story">
                <div className="story-quote">
                  &quot;I&apos;m coaching a 12U travel team. Parents are paying tournament fees and expecting results. I need to prepare for specific opponents and track 13 different players.&quot;
                </div>
                <div className="story-persona">— Derek, 12U Travel Ball Head Coach</div>
                <h3>The Problem</h3>
                <p>
                  Travel ball is high-stakes. You&apos;re preparing for specific opponents, managing playing time conversations, and trying to develop 13 players who all think they should start.
                </p>
                <h3>How BenchCoach Helps</h3>
                <p>
                  Track every player&apos;s skill ratings. Generate tournament-prep practices focused on specific scenarios (first-and-third defense, 2-strike hitting). Keep detailed notes to show parents concrete development. Share plans with assistant coaches.
                </p>
                <div className="feature-path">
                  <div className="feature-path-title">Feature Path</div>
                  <div className="feature-path-steps">
                    <span className="fp-step">Full Roster</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Skill Tracking</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Tournament Prep</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Coach Collaboration</span>
                  </div>
                </div>
              </div>

              <div className="app-preview">
                <div className="app-bar">
                  <div className="app-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div className="app-bar-title">Tournament Prep Practice</div>
                  <div className="app-bar-badge">Shared with Staff</div>
                </div>
                <div className="app-content">
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                    <h4 className="text-white font-bold mb-3 text-sm">Pre-Tournament Practice: First Inning Readiness</h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex gap-2">
                        <span className="px-2 py-1 bg-amber-500/20 text-amber-400 font-bold rounded shrink-0">15m</span>
                        <div>
                          <h5 className="text-white font-semibold">Game Day Warmup</h5>
                          <p className="text-slate-400">Run the exact warmup we&apos;ll use Saturday. Time it.</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 font-bold rounded shrink-0">20m</span>
                        <div>
                          <h5 className="text-white font-semibold">First-Pitch Fastball</h5>
                          <p className="text-slate-400">Every at-bat starts with hittable fastball. MUST swing at pitch 1.</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <span className="px-2 py-1 bg-green-500/20 text-green-400 font-bold rounded shrink-0">20m</span>
                        <div>
                          <h5 className="text-white font-semibold">First Inning Scrimmage</h5>
                          <p className="text-slate-400">Simulate innings 1-2 only. Treat it like the game started.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="features-used">
                  <span className="feature-pill active">Tournament Prep</span>
                  <span className="feature-pill active">Coach Sharing</span>
                  <span className="feature-pill active">Advanced Plans</span>
                </div>
              </div>
            </div>
          </section>

          {/* Use Case 7: Assistant Coach */}
          <section id="assistant" className="use-case">
            <div className="use-case-header">
              <div className="use-case-icon icon-coach">🤝</div>
              <div>
                <div className="persona-type label-coach">Assistant Coach</div>
                <h2>Run Practice When Head Coach Can&apos;t</h2>
              </div>
            </div>
            <div className="use-case-body">
              <div className="story">
                <div className="story-quote">
                  &quot;Coach Dave texted at 2pm: &apos;Can you run practice tonight?&apos; I panicked. Then I opened BenchCoach and had a plan ready by game time.&quot;
                </div>
                <div className="story-persona">— Chris, Assistant Coach for 8U Rec League</div>
                <h3>The Problem</h3>
                <p>
                  The head coach can&apos;t make it. You&apos;re on your own with 12 kids, anxious parents watching, and no plan. You know the basics but don&apos;t know what the team has been working on.
                </p>
                <h3>How BenchCoach Helps</h3>
                <p>
                  Assistant coaches get FREE access to the team&apos;s BenchCoach account. The AI already knows the team&apos;s goals, recent practice plans, and what each player is working on. Generate a practice plan that&apos;s consistent with what the head coach has been doing.
                </p>
                <div className="feature-path">
                  <div className="feature-path-title">Feature Path</div>
                  <div className="feature-path-steps">
                    <span className="fp-step">Shared Team Access</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">View Recent Plans</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Ask AI for Context</span>
                    <span className="fp-arrow">→</span>
                    <span className="fp-step">Generate & Run</span>
                  </div>
                </div>
              </div>

              <div className="app-preview">
                <div className="app-bar">
                  <div className="app-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div className="app-bar-title">Chat with AI Coach</div>
                  <div className="app-bar-badge">Team Context</div>
                </div>
                <div className="app-content">
                  <div className="space-y-3">
                    <div className="bg-red-600 text-white text-sm p-3 rounded-lg ml-auto max-w-[85%]">
                      Dave can&apos;t make it. I need to run practice tonight — 75 minutes. What has the team been working on?
                    </div>
                    <div className="bg-slate-700/50 text-slate-300 text-sm p-3 rounded-lg mr-auto max-w-[85%]">
                      Based on the last 3 practices, Coach Dave has focused on:<br/><br/>
                      • <strong className="text-white">Fly ball tracking</strong> — team struggles with balls over their heads<br/>
                      • <strong className="text-white">Baserunning</strong> — rounding first on hits to outfield<br/>
                      • <strong className="text-white">Hitting</strong> — tee work with focus on staying back<br/><br/>
                      Want me to build a 75-minute plan that continues these themes?
                    </div>
                  </div>
                </div>
                <div className="features-used">
                  <span className="feature-pill active">Coach Collaboration</span>
                  <span className="feature-pill active">Team Context</span>
                  <span className="feature-pill active">AI Memory</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* CTA */}
        <section className="cta-section">
          <div className="cta-inner">
            <h2>Ready to Coach Like This?</h2>
            <p>
              Whether you&apos;re a first-time coach or a seasoned veteran, BenchCoach gives you the tools to plan better practices, develop players faster, and coach with confidence.
            </p>
            <Link href="/auth/signup" className="cta-btn">
              Start Your Free Trial →
            </Link>
            <div className="cta-sub">$10/month after trial • Unlimited assistant coaches included</div>
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
    </>
  )
}
