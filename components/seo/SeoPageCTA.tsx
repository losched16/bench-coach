import Link from 'next/link'

interface SeoPageCTAProps {
  ageGroup?: string
}

export function SeoPageCTA({ ageGroup }: SeoPageCTAProps) {
  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 sm:p-10 my-12 text-white">
      <h2 className="text-2xl sm:text-3xl font-bold mb-4">
        {ageGroup 
          ? `Want AI-Powered Practice Plans for Your ${ageGroup} Team?`
          : 'Want AI-Powered Practice Plans for Your Team?'
        }
      </h2>
      <p className="text-lg mb-6 text-slate-300 leading-relaxed">
        BenchCoach generates custom practice plans in seconds, tailored to your team's age, skill level, and goals. 
        Get coaching advice, track player progress, and keep everything organized in one place.
      </p>
      <ul className="mb-8 space-y-2 text-slate-300">
        <li className="flex items-center gap-2">
          <span className="text-red-400">✓</span>
          AI-generated practice plans based on your team
        </li>
        <li className="flex items-center gap-2">
          <span className="text-red-400">✓</span>
          Track notes on every player
        </li>
        <li className="flex items-center gap-2">
          <span className="text-red-400">✓</span>
          Ask coaching questions anytime
        </li>
        <li className="flex items-center gap-2">
          <span className="text-red-400">✓</span>
          Built by a youth baseball coach
        </li>
      </ul>
      <div className="flex flex-col sm:flex-row gap-4">
        <Link
          href="/auth/signup"
          className="px-6 py-3 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors text-center"
        >
          Start Your Free Trial →
        </Link>
        <Link
          href="/#how-it-works"
          className="px-6 py-3 bg-slate-700 text-white rounded-lg font-bold hover:bg-slate-600 transition-colors text-center"
        >
          See How It Works
        </Link>
      </div>
      <p className="text-sm text-slate-400 mt-4">
        14-day free trial • Cancel anytime
      </p>
    </div>
  )
}
