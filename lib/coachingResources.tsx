// Coaching advice, kept from the original Help Center.
//
// THIS IS NOT PRODUCT DOCUMENTATION AND MUST NOT BE MIXED WITH IT.
//
// lib/helpContent.ts says how BenchCoach works — every step read off the
// component that renders the control it names, and a test that fails if a
// claim drifts. What is below is different in kind: opinions about coaching
// eight-year-olds, written by a person, true or not depending on your view.
//
// Both belong in Help. Presenting them as the same thing would be the mistake:
// a coach needs to know that "click Use this plan to save" is a fact about the
// software and "let them fail in practice so they are not afraid to in a game"
// is a point of view. The Help Center renders them in separate sections and
// labels them.
//
// Preserved rather than rewritten. It is good writing and none of it makes a
// claim about the software that could go stale.

import {
  Award, ClipboardList, Clock, Heart, Play, Target, Users, Zap,
} from 'lucide-react'

export interface CoachingResource {
  id: string
  title: string
  icon: React.ElementType
  category: string
  content: React.ReactNode
}

export const COACHING_RESOURCES: CoachingResource[] = [
    {
      id: 'age-appropriate',
      title: 'Age-Appropriate Coaching',
      icon: Target,
      category: 'coaching-tips',
      content: (
        <div className="space-y-4">
          <p>Different ages need different approaches:</p>
          <div className="space-y-3">
            <div className="bg-blue-50 p-3 rounded-lg">
              <h4 className="font-semibold text-blue-900">T-Ball / 4U-5U</h4>
              <p className="text-sm text-blue-800">5-10 min activities. Focus on FUN. Expect chaos!</p>
            </div>
            <div className="bg-green-50 p-3 rounded-lg">
              <h4 className="font-semibold text-green-900">Coach Pitch / 6U-8U</h4>
              <p className="text-sm text-green-800">10-15 min activities. Introduce mechanics. Use soft balls for fear.</p>
            </div>
            <div className="bg-yellow-50 p-3 rounded-lg">
              <h4 className="font-semibold text-yellow-900">Kid Pitch / 9U-10U</h4>
              <p className="text-sm text-yellow-800">15-20 min activities. Add game situations. Competition matters more.</p>
            </div>
            <div className="bg-orange-50 p-3 rounded-lg">
              <h4 className="font-semibold text-orange-900">Pre-Teen / 11U-12U</h4>
              <p className="text-sm text-orange-800">Longer drills. Advanced strategy. Balance competition with development.</p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'practice-structure',
      title: 'Structuring Effective Practices',
      icon: ClipboardList,
      category: 'coaching-tips',
      content: (
        <div className="space-y-4">
          <p>A well-structured practice keeps players engaged:</p>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-semibold mb-3">60-Minute Template:</h4>
            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded w-14 text-center">10 min</span>
                <span>Dynamic Warm-up</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded w-14 text-center">10 min</span>
                <span>Throwing Progression</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="bg-yellow-100 text-yellow-700 text-xs font-bold px-2 py-1 rounded w-14 text-center">15 min</span>
                <span>Skill Focus #1</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-1 rounded w-14 text-center">15 min</span>
                <span>Skill Focus #2</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded w-14 text-center">10 min</span>
                <span>Fun Activity / Scrimmage</span>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'dealing-with-fear',
      title: 'Helping Players Overcome Fear',
      icon: Heart,
      category: 'coaching-tips',
      content: (
        <div className="space-y-4">
          <p>Fear of the ball is the #1 obstacle for young players. It is fixable!</p>
          <div className="bg-red-50 p-4 rounded-lg">
            <h4 className="font-semibold text-red-900 mb-2">Signs of Fear:</h4>
            <ul className="text-sm text-red-800 space-y-1">
              <li>• Turning head away when catching</li>
              <li>• Closing eyes at contact</li>
              <li>• Flinching or pulling back</li>
              <li>• Bailing out on swings</li>
            </ul>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-semibold text-green-900 mb-2">How to Fix It:</h4>
            <ul className="text-sm text-green-800 space-y-1">
              <li>• Start with soft balls (tennis, wiffle)</li>
              <li>• Progress slowly - never rush</li>
              <li>• Build success with easy catches</li>
              <li>• Never force through fear</li>
              <li>• Celebrate small wins</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'keeping-engaged',
      title: 'Keeping Players Engaged',
      icon: Zap,
      category: 'coaching-tips',
      content: (
        <div className="space-y-4">
          <p>Bored players do not learn. Engaged players develop faster!</p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-green-50 p-4 rounded-lg">
              <h4 className="font-semibold text-green-900 mb-2">✅ Do This:</h4>
              <ul className="text-sm text-green-800 space-y-1">
                <li>• Keep drills short (8-12 min)</li>
                <li>• Use competition and games</li>
                <li>• Celebrate effort</li>
                <li>• Use names constantly</li>
                <li>• End with something fun</li>
              </ul>
            </div>
            <div className="bg-red-50 p-4 rounded-lg">
              <h4 className="font-semibold text-red-900 mb-2">❌ Avoid:</h4>
              <ul className="text-sm text-red-800 space-y-1">
                <li>• Long lines with standing</li>
                <li>• Talking too much</li>
                <li>• Only focusing on best players</li>
                <li>• Punishing with running</li>
                <li>• Ending on failure</li>
              </ul>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'positive-coaching',
      title: 'Positive Coaching Techniques',
      icon: Award,
      category: 'coaching-tips',
      content: (
        <div className="space-y-4">
          <p>How you communicate shapes how players feel about baseball.</p>
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-semibold text-green-900 mb-2">The Praise Sandwich:</h4>
            <ol className="text-sm text-green-700 space-y-1">
              <li>1. <strong>Praise</strong> something they did right</li>
              <li>2. <strong>Correct</strong> the one thing to fix</li>
              <li>3. <strong>Encourage</strong> the next attempt</li>
            </ol>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <h4 className="font-semibold text-yellow-900 mb-2">Power Phrases:</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-yellow-800">
              <div>&quot;I love the effort!&quot;</div>
              <div>&quot;You are getting better!&quot;</div>
              <div>&quot;Great hustle!&quot;</div>
              <div>&quot;That is the attitude!&quot;</div>
            </div>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-semibold text-blue-900 mb-2">The 5:1 Rule:</h4>
            <p className="text-sm text-blue-800">Aim for 5 positive comments for every 1 correction.</p>
          </div>
        </div>
      )
    },
    {
      id: 'parent-communication',
      title: 'Communicating with Parents',
      icon: Users,
      category: 'best-practices',
      content: (
        <div className="space-y-4">
          <p>Good parent communication prevents problems.</p>
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-semibold text-blue-900 mb-2">Season Kickoff Meeting:</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Set expectations (playing time, behavior)</li>
              <li>• Explain your philosophy</li>
              <li>• Share the schedule</li>
              <li>• Ask for volunteers</li>
            </ul>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <h4 className="font-semibold text-yellow-900 mb-2">The 24-Hour Rule:</h4>
            <p className="text-sm text-yellow-800">Ask parents to wait 24 hours after a game before discussing playing time. Emotions run high right after games.</p>
          </div>
        </div>
      )
    },
    {
      id: 'playing-time',
      title: 'Managing Playing Time',
      icon: Clock,
      category: 'best-practices',
      content: (
        <div className="space-y-4">
          <p>Playing time is the #1 source of conflict. Clear policies prevent problems.</p>
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-semibold text-blue-900 mb-2">Rec League Philosophy:</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• Equal or near-equal playing time</li>
              <li>• Everyone plays infield AND outfield</li>
              <li>• At least one at-bat per game</li>
              <li>• Rotate positions systematically</li>
            </ul>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-semibold text-green-900 mb-2">Tips:</h4>
            <ul className="text-sm text-green-800 space-y-1">
              <li>• Make rotation chart before each game</li>
              <li>• Track positions across the season</li>
              <li>• Do not hide weaker players</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'game-day',
      title: 'Game Day Best Practices',
      icon: Play,
      category: 'best-practices',
      content: (
        <div className="space-y-4">
          <p>Games are the payoff for practice!</p>
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-semibold text-blue-900 mb-2">Before:</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Arrive 30 minutes early</li>
              <li>• Have lineup ready</li>
              <li>• Structured warm-up</li>
              <li>• Quick positive huddle</li>
            </ul>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-semibold text-green-900 mb-2">During:</h4>
            <ul className="text-sm text-green-800 space-y-1">
              <li>• Focus on effort, not results</li>
              <li>• Keep dugout energy positive</li>
              <li>• Rotate as planned</li>
            </ul>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <h4 className="font-semibold text-yellow-900 mb-2">After:</h4>
            <ul className="text-sm text-yellow-800 space-y-1">
              <li>• Team cheer (win or lose!)</li>
              <li>• Quick positive recap</li>
              <li>• Save feedback for practice</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'season-planning',
      title: 'Season Planning',
      icon: Target,
      category: 'best-practices',
      content: (
        <div className="space-y-4">
          <p>A great season does not happen by accident.</p>
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-semibold text-blue-900 mb-2">Early Season:</h4>
            <p className="text-sm text-blue-800">Focus on fundamentals. Build team culture. Keep competition low-pressure.</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-semibold text-green-900 mb-2">Mid Season:</h4>
            <p className="text-sm text-green-800">Add game situations. Address weaknesses. Increase competitive elements.</p>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <h4 className="font-semibold text-yellow-900 mb-2">Late Season:</h4>
            <p className="text-sm text-yellow-800">Refine what works. Build confidence. Prepare for celebration!</p>
          </div>
        </div>
      )
    },
]
