'use client'

// A textarea the coach owns, with help they have to ask for.
//
// The interaction is the product principle made concrete. The coach types.
// Nothing happens. If they want help they press a button, and what comes back
// is shown NEXT TO their own words rather than replacing them — so the choice
// on screen is a real one, between two things they can both read.
//
// The four buttons are the whole argument:
//
//   Use this          the suggestion becomes their text, still editable
//   Try again         a different attempt, original still untouched
//   Keep mine         dismiss it, exactly as it was before they asked
//   (just keep typing) the suggestion is not committed by ignoring it
//
// There is deliberately no auto-apply, no "improving as you type", and no
// state in which the model's words are in the box without the coach having
// pressed something. A report about somebody's child is not a place for a
// default that happens when you say nothing.

import { useState } from 'react'
import { Sparkles, Loader2, Check, RotateCcw, X, AlertCircle } from 'lucide-react'
import { useTracker } from '@/lib/tracking'

export type AssistKind = 'strengths' | 'development' | 'closing'

interface AiAssistProps {
  reportId: string
  kind: AssistKind
  value: string
  onChange: (next: string) => void
  label: string
  placeholder?: string
  /** The development area this text belongs to, for context. */
  focusLabel?: string | null
  rows?: number
  disabled?: boolean
  /** Rendered under the label — what to actually write here. */
  hint?: string
  id?: string
  /**
   * Called with the coach's own text the first time they ask for help.
   *
   * That text is the only evidence that the approved wording says the same
   * thing the coach meant. Once a suggestion is accepted it is gone from the
   * screen, so it has to be captured at the moment they press the button.
   */
  onAssistRequested?: (originalText: string) => void
}

export function AiAssist({
  reportId, kind, value, onChange, label, placeholder,
  focusLabel = null, rows = 5, disabled = false, hint, id, onAssistRequested,
}: AiAssistProps) {
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const track = useTracker()

  const fieldId = id || `assist-${kind}-${reportId.slice(0, 8)}`
  const hasText = value.trim().length > 0

  const ask = async () => {
    if (!hasText || loading) return
    onAssistRequested?.(value)
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/player-reports/improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, kind, text: value, focusLabel }),
      })
      const data = await res.json()
      if (data?.suggestion) {
        setSuggestion(data.suggestion)
      } else {
        // The route answers 200 with a message when the model is unavailable,
        // because nothing is wrong with the coach's report.
        setSuggestion(null)
        setMessage(data?.message || data?.error || "BenchCoach couldn't improve this wording right now. Your original comments are still saved.")
      }
    } catch {
      setSuggestion(null)
      setMessage("BenchCoach couldn't reach the wording assistant. Your original comments are still saved.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <label htmlFor={fieldId} className="block text-sm font-medium text-gray-900">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}

      <textarea
        id={fieldId}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        className="mt-2 w-full px-3 py-2.5 text-[16px] leading-relaxed border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 disabled:bg-gray-50 disabled:text-gray-500"
      />

      {!disabled && (
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={ask}
            disabled={!hasText || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? <Loader2 size={15} className="animate-spin" aria-hidden />
              : <Sparkles size={15} className="text-red-600" aria-hidden />}
            {loading ? 'Working…' : 'Improve wording'}
          </button>
          {!hasText && (
            <span className="text-xs text-gray-400">Write a few words first</span>
          )}
        </div>
      )}

      {/* aria-live so a screen reader hears the suggestion arrive rather than
          finding it later by accident. */}
      <div aria-live="polite">
        {message && (
          <div className="mt-3 flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
            <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden />
            <span>{message}</span>
          </div>
        )}

        {suggestion && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60 overflow-hidden">
            <div className="px-3 py-2 border-b border-red-200 flex items-center gap-1.5">
              <Sparkles size={14} className="text-red-600" aria-hidden />
              <span className="text-xs font-semibold text-red-800 uppercase tracking-wide">
                BenchCoach suggests
              </span>
            </div>
            <p className="px-3 py-3 text-[15px] leading-relaxed text-gray-800 whitespace-pre-wrap">
              {suggestion}
            </p>
            <div className="px-3 pb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  // Fired on accept rather than on ask. Pressing the button is
                  // curiosity; keeping the words is the thing worth counting.
                  track('player_report_ai_rewrite_used', { reportId, kind })
                  onChange(suggestion)
                  setSuggestion(null)
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                <Check size={15} aria-hidden />
                Use this
              </button>
              <button
                type="button"
                onClick={ask}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RotateCcw size={15} aria-hidden />
                Try again
              </button>
              <button
                type="button"
                onClick={() => setSuggestion(null)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                <X size={15} aria-hidden />
                Keep mine
              </button>
            </div>
            <p className="px-3 pb-3 -mt-1 text-xs text-gray-500">
              Use this puts it in the box above — you can still edit every word of it.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default AiAssist
