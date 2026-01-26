'use client'

import { useState } from 'react'
import { 
  HelpCircle, MessageSquare, Users, StickyNote, ClipboardList, 
  Library, BookOpen, Bookmark, ChevronDown, ChevronUp,
  Lightbulb, Target, Clock, CheckCircle, Star, Zap, Heart,
  Search, Home, Play, Award
} from 'lucide-react'

interface HelpArticle {
  id: string
  title: string
  icon: React.ElementType
  category: string
  content: React.ReactNode
}

export default function HelpPage() {
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  const categories = [
    { id: 'all', label: 'All Topics', icon: HelpCircle },
    { id: 'getting-started', label: 'Getting Started', icon: Play },
    { id: 'features', label: 'Features', icon: Zap },
    { id: 'coaching-tips', label: 'Coaching Tips', icon: Lightbulb },
    { id: 'best-practices', label: 'Best Practices', icon: Award },
  ]

  const helpArticles: HelpArticle[] = [
    {
      id: 'welcome',
      title: 'Welcome to BenchCoach',
      icon: Home,
      category: 'getting-started',
      content: (
        <div className="space-y-4">
          <p>BenchCoach is your AI-powered assistant for youth baseball coaching. Whether you are a first-time parent coach or experienced volunteer, BenchCoach helps you run better practices and track player development.</p>
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-semibold text-blue-900 mb-2">What BenchCoach Helps You Do:</h4>
            <ul className="space-y-2 text-blue-800">
              <li className="flex items-start space-x-2">
                <CheckCircle size={18} className="flex-shrink-0 mt-0.5" />
                <span>Plan effective practices with AI-generated or custom plans</span>
              </li>
              <li className="flex items-start space-x-2">
                <CheckCircle size={18} className="flex-shrink-0 mt-0.5" />
                <span>Track player progress with notes and focus areas</span>
              </li>
              <li className="flex items-start space-x-2">
                <CheckCircle size={18} className="flex-shrink-0 mt-0.5" />
                <span>Get instant coaching advice through AI chat</span>
              </li>
              <li className="flex items-start space-x-2">
                <CheckCircle size={18} className="flex-shrink-0 mt-0.5" />
                <span>Follow structured skill progressions with Playbooks</span>
              </li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'quick-start',
      title: 'Quick Start Guide',
      icon: Zap,
      category: 'getting-started',
      content: (
        <div className="space-y-4">
          <p className="font-medium">Get up and running in 5 minutes:</p>
          <div className="space-y-3">
            <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
              <div className="bg-blue-600 text-white text-sm font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">1</div>
              <div>
                <div className="font-medium">Add Your Players</div>
                <div className="text-sm text-gray-600">Go to Roster and add each player with their name and jersey number.</div>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
              <div className="bg-blue-600 text-white text-sm font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">2</div>
              <div>
                <div className="font-medium">Generate a Practice Plan</div>
                <div className="text-sm text-gray-600">Go to Practice Plans → Generate with AI. Enter duration and focus areas.</div>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
              <div className="bg-blue-600 text-white text-sm font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">3</div>
              <div>
                <div className="font-medium">Ask the AI Anything</div>
                <div className="text-sm text-gray-600">Use Chat to ask questions like &quot;How do I teach fly balls to 7-year-olds?&quot;</div>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
              <div className="bg-blue-600 text-white text-sm font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">4</div>
              <div>
                <div className="font-medium">Start a Playbook</div>
                <div className="text-sm text-gray-600">Go to Playbooks and start a structured progression for skill building.</div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'ai-chat',
      title: 'AI Chat Assistant',
      icon: MessageSquare,
      category: 'features',
      content: (
        <div className="space-y-4">
          <p>The AI Chat is your personal coaching consultant. Ask it anything about youth baseball!</p>
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-semibold text-green-900 mb-2">Great Questions to Ask:</h4>
            <ul className="space-y-1 text-green-800 text-sm">
              <li>• &quot;How do I teach throwing mechanics to 6-year-olds?&quot;</li>
              <li>• &quot;What drills help with fear of the ball?&quot;</li>
              <li>• &quot;Give me a fun warm-up for 8U players&quot;</li>
              <li>• &quot;How should I handle a struggling player?&quot;</li>
              <li>• &quot;What batting order strategy works best?&quot;</li>
            </ul>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <h4 className="font-semibold text-yellow-900 mb-2">Pro Tips:</h4>
            <ul className="space-y-1 text-yellow-800 text-sm">
              <li>• Be specific about age group - &quot;6U&quot; vs &quot;12U&quot; matters</li>
              <li>• Ask follow-up questions to dig deeper</li>
              <li>• Save drills you like to your Saved Drills library</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'roster',
      title: 'Managing Your Roster',
      icon: Users,
      category: 'features',
      content: (
        <div className="space-y-4">
          <p>Your roster helps the AI give personalized recommendations and lets you track individual progress.</p>
          <h4 className="font-semibold">Player Information to Include:</h4>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start space-x-2">
              <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
              <span><strong>Name & Number:</strong> Basic identification</span>
            </li>
            <li className="flex items-start space-x-2">
              <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
              <span><strong>Positions:</strong> Where they play and want to learn</span>
            </li>
            <li className="flex items-start space-x-2">
              <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
              <span><strong>Focus Areas:</strong> Skills they need to develop</span>
            </li>
          </ul>
        </div>
      )
    },
    {
      id: 'practice-plans',
      title: 'Practice Plans',
      icon: ClipboardList,
      category: 'features',
      content: (
        <div className="space-y-4">
          <p>Create structured practice plans that make the most of your field time.</p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-purple-50 p-4 rounded-lg">
              <h4 className="font-semibold text-purple-900 mb-2">🤖 AI-Generated Plans</h4>
              <ul className="text-sm text-purple-700 space-y-1">
                <li>• Set duration (45-90 min)</li>
                <li>• Choose focus areas</li>
                <li>• Get complete plan instantly</li>
              </ul>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg">
              <h4 className="font-semibold text-orange-900 mb-2">✏️ Custom Plans</h4>
              <ul className="text-sm text-orange-700 space-y-1">
                <li>• Build block by block</li>
                <li>• Add your own notes</li>
                <li>• Save as template</li>
              </ul>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'playbooks',
      title: 'Progression Playbooks',
      icon: BookOpen,
      category: 'features',
      content: (
        <div className="space-y-4">
          <p>Playbooks are multi-week training programs that build skills through progressive drills. Each day builds on the previous one.</p>
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-semibold text-green-900 mb-2">Available Playbooks:</h4>
            <ul className="space-y-2 text-green-800">
              <li>• <strong>30 Days to Catching Fly Balls</strong> (6U-8U)</li>
              <li>• <strong>21 Days to Better Throwing</strong> (All Ages)</li>
              <li>• <strong>14 Days to Confident Hitting</strong> (8U-10U)</li>
              <li>• <strong>30 Days to Infield Ready</strong> (8U-12U)</li>
            </ul>
          </div>
          <h4 className="font-semibold">Each Session Includes:</h4>
          <ul className="text-sm space-y-1">
            <li>• <strong>Detailed Drills</strong> - Step-by-step instructions</li>
            <li>• <strong>Coaching Cues</strong> - What to say to players</li>
            <li>• <strong>Common Problems</strong> - How to fix issues</li>
            <li>• <strong>Parent Homework</strong> - Practice at home</li>
          </ul>
        </div>
      )
    },
    {
      id: 'notes',
      title: 'Player Notes',
      icon: StickyNote,
      category: 'features',
      content: (
        <div className="space-y-4">
          <p>Track observations and progress for each player throughout the season.</p>
          <h4 className="font-semibold">What to Document:</h4>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start space-x-2">
              <Star size={16} className="text-yellow-500 flex-shrink-0 mt-0.5" />
              <span><strong>Wins:</strong> &quot;First fly ball catch today!&quot;</span>
            </li>
            <li className="flex items-start space-x-2">
              <Target size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <span><strong>Work On:</strong> &quot;Dropping elbow on throws&quot;</span>
            </li>
            <li className="flex items-start space-x-2">
              <Heart size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <span><strong>Personal:</strong> &quot;Responds well to encouragement&quot;</span>
            </li>
          </ul>
        </div>
      )
    },
    {
      id: 'saved-drills',
      title: 'Saved Drills Library',
      icon: Bookmark,
      category: 'features',
      content: (
        <div className="space-y-4">
          <p>Build your personal library of go-to drills. Save from AI chat or create your own.</p>
          <h4 className="font-semibold">Categories:</h4>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="bg-green-100 text-green-700 px-3 py-1 rounded text-center">Fielding</div>
            <div className="bg-red-100 text-red-700 px-3 py-1 rounded text-center">Hitting</div>
            <div className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-center">Throwing</div>
            <div className="bg-orange-100 text-orange-700 px-3 py-1 rounded text-center">Baserunning</div>
            <div className="bg-purple-100 text-purple-700 px-3 py-1 rounded text-center">Warm-up</div>
            <div className="bg-gray-100 text-gray-700 px-3 py-1 rounded text-center">General</div>
          </div>
        </div>
      )
    },
    {
      id: 'practice-library',
      title: 'Practice Library',
      icon: Library,
      category: 'features',
      content: (
        <div className="space-y-4">
          <p>Store and reuse your favorite practice plan templates throughout the season.</p>
          <h4 className="font-semibold">Template Ideas:</h4>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start space-x-2">
              <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
              <span><strong>Season Opener:</strong> Fundamentals and team building</span>
            </li>
            <li className="flex items-start space-x-2">
              <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
              <span><strong>Game Day Warm-up:</strong> Consistent pre-game routine</span>
            </li>
            <li className="flex items-start space-x-2">
              <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
              <span><strong>Skill Focus:</strong> Hitting Practice, Fielding Practice</span>
            </li>
            <li className="flex items-start space-x-2">
              <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
              <span><strong>Fun Day:</strong> Games and competitions</span>
            </li>
          </ul>
        </div>
      )
    },
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

  const filteredArticles = helpArticles.filter(article => {
    const matchesCategory = selectedCategory === 'all' || article.category === selectedCategory
    const matchesSearch = searchQuery === '' || 
      article.title.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Help & Resources</h2>
        <p className="text-gray-600">Everything you need to get the most out of BenchCoach</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="Search help articles..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => {
          const Icon = cat.icon
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Icon size={18} />
              <span>{cat.label}</span>
            </button>
          )
        })}
      </div>

      <div className="space-y-3">
        {filteredArticles.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <HelpCircle className="mx-auto text-gray-400 mb-4" size={48} />
            <p className="text-gray-600">No articles found matching your search.</p>
          </div>
        ) : (
          filteredArticles.map((article) => {
            const Icon = article.icon
            return (
              <div key={article.id} className="bg-white rounded-lg shadow overflow-hidden">
                <button
                  onClick={() => setExpandedArticle(expandedArticle === article.id ? null : article.id)}
                  className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <div className="bg-blue-100 text-blue-600 p-2 rounded-lg">
                      <Icon size={20} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-semibold text-gray-900">{article.title}</h3>
                      <span className="text-xs text-gray-500 capitalize">{article.category.replace('-', ' ')}</span>
                    </div>
                  </div>
                  {expandedArticle === article.id ? (
                    <ChevronUp className="text-gray-400" size={20} />
                  ) : (
                    <ChevronDown className="text-gray-400" size={20} />
                  )}
                </button>
                
                {expandedArticle === article.id && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    <div className="pt-4">
                      {article.content}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg shadow p-6 text-white">
        <div className="flex items-start space-x-4">
          <div className="bg-white/20 p-3 rounded-lg">
            <MessageSquare size={24} />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Still have questions?</h3>
            <p className="text-blue-100 mt-1">
              Use the AI Chat to ask any coaching question - like having an experienced coach on call 24/7!
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}