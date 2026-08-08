'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Send, MessageSquare, Plus, AlertCircle } from 'lucide-react'

// Talking about one opponent.
//
// CoachAI already reads scouting data, but it has to GUESS that a conversation
// is about an opponent — it looks for the team's name, or for phrasing like
// "who can they pitch". Standing on Springfield's page and asking "what about
// their two-hole?" names nobody, so the guess misses and the answer comes back
// with nothing behind it.
//
// Opening the conversation from here removes the guess. Every message is about
// this team, and the thread remembers that a week later.
//
// It is the same chat, not a second one: same threads, same titling, same
// voice, same guardrails. Only the scope is pinned.

interface Msg { role: 'user' | 'assistant'; content: string }

interface ThreadSummary {
  id: string
  title: string | null
  last_message_at: string | null
  message_count: number
  preview: string | null
}

interface Props {
  teamId: string
  opponentTeamId: string
  opponentName: string
}

export function OpponentChat({ teamId, opponentTeamId, opponentName }: Props) {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/chat/threads?teamId=${teamId}&opponentTeamId=${opponentTeamId}`
      )
      const d = await res.json()
      setThreads(d.threads || [])
      return d.threads || []
    } catch {
      return []
    }
  }, [teamId, opponentTeamId])

  const loadMessages = useCallback(async (id: string | null) => {
    try {
      const url = id
        ? `/api/chat?teamId=${teamId}&threadId=${id}`
        : `/api/chat?teamId=${teamId}&opponentTeamId=${opponentTeamId}`
      const res = await fetch(url)
      const d = await res.json()
      setThreadId(d.threadId || null)
      setMessages(
        (d.messages || []).map((m: any) => ({ role: m.role, content: m.content }))
      )
    } catch {
      setError('Could not open that conversation.')
    }
  }, [teamId, opponentTeamId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const t = await loadThreads()
      if (cancelled) return
      // Pick up where they left off with THIS team, not with whatever was open
      // last somewhere else.
      await loadMessages(t.length > 0 ? t[0].id : null)
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [loadThreads, loadMessages])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setError(null)
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setSending(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          opponentTeamId,
          threadId,
          message: text,
          history: messages.slice(-10),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Something went wrong')
      setMessages(prev => [...prev, { role: 'assistant', content: d.message }])
      if (d.threadId) setThreadId(d.threadId)
      loadThreads()
    } catch (e: any) {
      setError(e.message)
      // The question stays in the box on failure rather than vanishing with it.
      setInput(text)
      setMessages(prev => prev.slice(0, -1))
    } finally {
      setSending(false)
    }
  }

  const startNew = async () => {
    setThreadId(null)
    setMessages([])
    setError(null)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
        <Loader2 className="animate-spin" size={15} /> Opening…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <MessageSquare size={16} className="text-gray-400" />
          Ask about {opponentName}
        </h3>
        <div className="flex items-center gap-2">
          {threads.length > 0 && (
            <select
              value={threadId || ''}
              onChange={e => loadMessages(e.target.value || null)}
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white max-w-[10rem]"
              aria-label="Conversation"
            >
              {threads.map(t => (
                <option key={t.id} value={t.id}>
                  {t.title || t.preview?.slice(0, 40) || 'Untitled'}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={startNew}
            className="flex items-center gap-1 text-xs font-medium text-blue-600"
          >
            <Plus size={13} /> New
          </button>
        </div>
      </div>

      <div className="border border-gray-200 rounded-lg bg-gray-50 max-h-[26rem] overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-sm text-gray-500 space-y-2 py-2">
            <p>
              Everything you&apos;ve logged about {opponentName} is loaded. Ask away —
              and it&apos;ll tell you how old the data is rather than pretending it&apos;s
              current.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                'Who can they pitch on Sunday?',
                'What do we know about their lineup?',
                'How should we set up against them?',
                'Do they run?',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="px-2.5 py-1.5 rounded-full border border-gray-300 bg-white text-xs text-gray-700"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`text-sm whitespace-pre-wrap rounded-lg px-3 py-2 ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white ml-8'
                  : 'bg-white border border-gray-200 text-gray-900 mr-4'
              }`}
            >
              {m.content}
            </div>
          ))
        )}
        {sending && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="animate-spin" size={14} /> Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="flex gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          rows={2}
          placeholder={`Ask about ${opponentName}…`}
          className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="px-4 bg-blue-600 text-white rounded-xl disabled:opacity-50"
          aria-label="Send"
        >
          <Send size={17} />
        </button>
      </div>

      <p className="text-xs text-gray-400">
        Answers come from what you&apos;ve logged about this team and nothing else — no
        other coach&apos;s data, and only what can be seen on a field.
      </p>
    </div>
  )
}
