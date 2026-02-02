'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { ArrowLeft, Plus, X, ThumbsUp, ThumbsDown, User, Sun, Cloud, CloudRain, Snowflake, Zap, Check, Loader2 } from 'lucide-react'

interface Player {
  id: string
  player: {
    id: string
    name: string
    jersey_number: string | null
  }
}

interface PracticePlan {
  id: string
  title: string
  duration_minutes: number
  focus: string[]
  content: any
  created_at: string
}

interface PlayerCallout {
  player_id: string
  player_name: string
  note: string
  type: 'positive' | 'concern' | 'observation'
}

const WEATHER_OPTIONS = [
  { value: 'sunny', label: 'Sunny', icon: Sun },
  { value: 'cloudy', label: 'Cloudy', icon: Cloud },
  { value: 'rainy', label: 'Rainy', icon: CloudRain },
  { value: 'cold', label: 'Cold', icon: Snowflake },
  { value: 'indoor', label: 'Indoor', icon: Zap },
]

const ENERGY_OPTIONS = [
  { value: 'low', label: 'Low Energy', emoji: '😴', desc: 'Sluggish, hard to focus' },
  { value: 'medium', label: 'Medium', emoji: '👍', desc: 'Normal day' },
  { value: 'high', label: 'High Energy', emoji: '🔥', desc: 'Locked in, great effort' },
]

export default function RecapPage() {
  const [plan, setPlan] = useState<PracticePlan | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Form state
  const [practiceDate, setPracticeDate] = useState(new Date().toISOString().split('T')[0])
  const [attendanceCount, setAttendanceCount] = useState<number | null>(null)
  const [weather, setWeather] = useState('sunny')
  const [energyLevel, setEnergyLevel] = useState('medium')
  const [whatWorked, setWhatWorked] = useState<string[]>([])
  const [whatWorkedInput, setWhatWorkedInput] = useState('')
  const [whatDidntWork, setWhatDidntWork] = useState<string[]>([])
  const [whatDidntInput, setWhatDidntInput] = useState('')
  const [playerCallouts, setPlayerCallouts] = useState<PlayerCallout[]>([])
  const [calloutPlayerId, setCalloutPlayerId] = useState('')
  const [calloutNote, setCalloutNote] = useState('')
  const [calloutType, setCalloutType] = useState<'positive' | 'concern' | 'observation'>('positive')
  const [nextFocus, setNextFocus] = useState<string[]>([])
  const [nextFocusInput, setNextFocusInput] = useState('')
  const [overallNotes, setOverallNotes] = useState('')

  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const planId = searchParams.get('planId')
  const router = useRouter()
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) loadData()
  }, [teamId, planId])

  const loadData = async () => {
    try {
      // Load players for callouts
      const { data: rosterData } = await supabase
        .from('team_players')
        .select('id, player:players(id, name, jersey_number)')
        .eq('team_id', teamId)

      if (rosterData) setPlayers(rosterData as any)

      // Load practice plan if planId provided
      if (planId) {
        const { data: planData } = await supabase
          .from('practice_plans')
          .select('*')
          .eq('id', planId)
          .single()

        if (planData) {
          setPlan(planData)
          // Pre-populate next_focus from the plan's focus areas
          if (planData.focus) {
            setNextFocus(planData.focus)
          }
        }
      }
    } catch (error) {
      console.error('Error loading recap data:', error)
    } finally {
      setLoading(false)
    }
  }

  // ── List helpers ──────────────────────────────────────

  const addToList = (
    input: string,
    setInput: (s: string) => void,
    list: string[],
    setList: (l: string[]) => void
  ) => {
    const trimmed = input.trim()
    if (trimmed && !list.includes(trimmed)) {
      setList([...list, trimmed])
      setInput('')
    }
  }

  const removeFromList = (index: number, list: string[], setList: (l: string[]) => void) => {
    setList(list.filter((_, i) => i !== index))
  }

  // ── Player callout helpers ────────────────────────────

  const addPlayerCallout = () => {
    if (!calloutPlayerId || !calloutNote.trim()) return

    const player = players.find(p => p.player.id === calloutPlayerId)
    if (!player) return

    setPlayerCallouts([...playerCallouts, {
      player_id: calloutPlayerId,
      player_name: player.player.name,
      note: calloutNote.trim(),
      type: calloutType,
    }])
    setCalloutPlayerId('')
    setCalloutNote('')
    setCalloutType('positive')
  }

  const removeCallout = (index: number) => {
    setPlayerCallouts(playerCallouts.filter((_, i) => i !== index))
  }

  // ── Save ──────────────────────────────────────────────

  const handleSave = async () => {
    if (!teamId) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('practice_sessions')
        .insert({
          team_id: teamId,
          practice_plan_id: planId || null,
          date: practiceDate,
          recap_note: overallNotes || null,
          what_worked: whatWorked,
          what_didnt_work: whatDidntWork,
          player_callouts: playerCallouts,
          energy_level: energyLevel,
          attendance_count: attendanceCount,
          weather: weather,
          next_focus: nextFocus,
        })

      if (error) throw error

      // Also save player callouts as player_notes for persistence
      for (const callout of playerCallouts) {
        await supabase
          .from('player_notes')
          .insert({
            team_id: teamId,
            player_id: callout.player_id,
            note: `[Practice ${practiceDate}] ${callout.type === 'positive' ? '✅' : callout.type === 'concern' ? '⚠️' : '📝'} ${callout.note}`,
          })
      }

      setSaved(true)
      setTimeout(() => {
        router.push(`/dashboard/practice?teamId=${teamId}`)
      }, 1500)
    } catch (error) {
      console.error('Error saving recap:', error)
      alert('Failed to save recap')
    } finally {
      setSaving(false)
    }
  }

  // ── Loading / Success states ──────────────────────────

  if (loading) {
    return <div className="text-gray-600">Loading...</div>
  }

  if (saved) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="bg-green-50 rounded-2xl p-8">
          <Check className="mx-auto text-green-600 mb-4" size={48} />
          <h2 className="text-2xl font-bold text-green-900 mb-2">Recap Saved!</h2>
          <p className="text-green-700">
            Your notes will be used to make the next practice plan even better.
          </p>
        </div>
      </div>
    )
  }

  // ── Main Form ─────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <button
          onClick={() => router.push(`/dashboard/practice?teamId=${teamId}`)}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Practice Recap</h2>
          {plan && (
            <p className="text-sm text-gray-600 mt-1">
              For: {plan.title} ({plan.duration_minutes} min)
            </p>
          )}
        </div>
      </div>

      {/* Date & Attendance */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-md font-semibold text-gray-900 mb-4">Basics</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Practice Date</label>
            <input
              type="date"
              value={practiceDate}
              onChange={(e) => setPracticeDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Players Present</label>
            <input
              type="number"
              value={attendanceCount ?? ''}
              onChange={(e) => setAttendanceCount(e.target.value ? parseInt(e.target.value) : null)}
              placeholder="e.g. 11"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Weather & Energy */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-md font-semibold text-gray-900 mb-4">Conditions & Energy</h3>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Weather</label>
          <div className="flex flex-wrap gap-2">
            {WEATHER_OPTIONS.map(opt => {
              const Icon = opt.icon
              return (
                <button
                  key={opt.value}
                  onClick={() => setWeather(opt.value)}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg border-2 transition-colors ${
                    weather === opt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <Icon size={16} />
                  <span className="text-sm">{opt.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Team Energy Level</label>
          <div className="grid grid-cols-3 gap-3">
            {ENERGY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setEnergyLevel(opt.value)}
                className={`p-3 rounded-lg border-2 text-center transition-colors ${
                  energyLevel === opt.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-2xl mb-1">{opt.emoji}</div>
                <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                <div className="text-xs text-gray-500">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* What Worked */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-md font-semibold text-gray-900 mb-1 flex items-center space-x-2">
          <ThumbsUp size={18} className="text-green-600" />
          <span>What Worked</span>
        </h3>
        <p className="text-sm text-gray-500 mb-3">Drills, activities, or approaches that went well</p>

        <div className="flex space-x-2 mb-3">
          <input
            value={whatWorkedInput}
            onChange={(e) => setWhatWorkedInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addToList(whatWorkedInput, setWhatWorkedInput, whatWorked, setWhatWorked)}
            placeholder="e.g. Relay race drill was great"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <button
            onClick={() => addToList(whatWorkedInput, setWhatWorkedInput, whatWorked, setWhatWorked)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus size={18} />
          </button>
        </div>

        {whatWorked.length > 0 && (
          <div className="space-y-2">
            {whatWorked.map((item, i) => (
              <div key={i} className="flex items-center justify-between bg-green-50 px-3 py-2 rounded-lg">
                <span className="text-sm text-green-800">✅ {item}</span>
                <button onClick={() => removeFromList(i, whatWorked, setWhatWorked)} className="text-green-600 hover:text-green-800">
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* What Didn't Work */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-md font-semibold text-gray-900 mb-1 flex items-center space-x-2">
          <ThumbsDown size={18} className="text-orange-600" />
          <span>What Didn't Work</span>
        </h3>
        <p className="text-sm text-gray-500 mb-3">Things to change or skip next time</p>

        <div className="flex space-x-2 mb-3">
          <input
            value={whatDidntInput}
            onChange={(e) => setWhatDidntInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addToList(whatDidntInput, setWhatDidntInput, whatDidntWork, setWhatDidntWork)}
            placeholder="e.g. Fly ball drill too advanced for this group"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          />
          <button
            onClick={() => addToList(whatDidntInput, setWhatDidntInput, whatDidntWork, setWhatDidntWork)}
            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
          >
            <Plus size={18} />
          </button>
        </div>

        {whatDidntWork.length > 0 && (
          <div className="space-y-2">
            {whatDidntWork.map((item, i) => (
              <div key={i} className="flex items-center justify-between bg-orange-50 px-3 py-2 rounded-lg">
                <span className="text-sm text-orange-800">⚠️ {item}</span>
                <button onClick={() => removeFromList(i, whatDidntWork, setWhatDidntWork)} className="text-orange-600 hover:text-orange-800">
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Player Callouts */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-md font-semibold text-gray-900 mb-1 flex items-center space-x-2">
          <User size={18} className="text-blue-600" />
          <span>Player Callouts</span>
        </h3>
        <p className="text-sm text-gray-500 mb-3">Notable observations about individual players</p>

        <div className="space-y-3 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={calloutPlayerId}
              onChange={(e) => setCalloutPlayerId(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select player...</option>
              {players.map(p => (
                <option key={p.player.id} value={p.player.id}>
                  {p.player.name}{p.player.jersey_number ? ` #${p.player.jersey_number}` : ''}
                </option>
              ))}
            </select>
            <div className="flex space-x-1">
              {(['positive', 'concern', 'observation'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setCalloutType(type)}
                  className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium border-2 transition-colors ${
                    calloutType === type
                      ? type === 'positive' ? 'border-green-500 bg-green-50 text-green-700'
                        : type === 'concern' ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {type === 'positive' ? '✅ Win' : type === 'concern' ? '⚠️ Concern' : '📝 Note'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex space-x-2">
            <input
              value={calloutNote}
              onChange={(e) => setCalloutNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPlayerCallout()}
              placeholder="e.g. Great improvement on throws to first"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={addPlayerCallout}
              disabled={!calloutPlayerId || !calloutNote.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        {playerCallouts.length > 0 && (
          <div className="space-y-2">
            {playerCallouts.map((callout, i) => (
              <div
                key={i}
                className={`flex items-start justify-between px-3 py-2 rounded-lg ${
                  callout.type === 'positive' ? 'bg-green-50'
                    : callout.type === 'concern' ? 'bg-orange-50'
                    : 'bg-blue-50'
                }`}
              >
                <div>
                  <span className="text-sm font-medium text-gray-900">{callout.player_name}</span>
                  <span className="text-sm text-gray-600 ml-2">
                    {callout.type === 'positive' ? '✅' : callout.type === 'concern' ? '⚠️' : '📝'} {callout.note}
                  </span>
                </div>
                <button onClick={() => removeCallout(i)} className="text-gray-400 hover:text-gray-600 ml-2 mt-0.5">
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Next Focus Areas */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-md font-semibold text-gray-900 mb-1">Focus for Next Practice</h3>
        <p className="text-sm text-gray-500 mb-3">What should the next plan prioritize?</p>

        <div className="flex space-x-2 mb-3">
          <input
            value={nextFocusInput}
            onChange={(e) => setNextFocusInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addToList(nextFocusInput, setNextFocusInput, nextFocus, setNextFocus)}
            placeholder="e.g. throwing accuracy"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <button
            onClick={() => addToList(nextFocusInput, setNextFocusInput, nextFocus, setNextFocus)}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Plus size={18} />
          </button>
        </div>

        {nextFocus.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {nextFocus.map((item, i) => (
              <span key={i} className="flex items-center space-x-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
                <span>{item}</span>
                <button onClick={() => removeFromList(i, nextFocus, setNextFocus)} className="text-purple-600 hover:text-purple-800">
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Overall Notes */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-md font-semibold text-gray-900 mb-1">Additional Notes</h3>
        <p className="text-sm text-gray-500 mb-3">Anything else worth remembering</p>
        <textarea
          value={overallNotes}
          onChange={(e) => setOverallNotes(e.target.value)}
          placeholder="e.g. Need to split into two groups next time — too many kids for one station..."
          rows={3}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
      </div>

      {/* Save Button */}
      <div className="flex justify-end pb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center space-x-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium text-lg"
        >
          {saving ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Check size={20} />
              <span>Save Recap</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
