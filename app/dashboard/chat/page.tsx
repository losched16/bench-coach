'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Send, Loader2, Menu, X, Target, Users, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { ChatMessageContent } from '@/components/ChatMessageContent'
import { ChatThreadList, ChatThread } from '@/components/ChatThreadList'
import { SupersedeConfirm, Superseding } from '@/components/SupersedeConfirm'
import { META_SENTINEL } from '@/lib/analysis'
import { usePageView, useTracker } from '@/lib/tracking'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  memory_suggestions?: any
  // Set on the analysis written into the thread when a priority is committed,
  // so it renders as a decision rather than another chat reply.
  meta?: { kind?: string; prescriptionId?: string | null; playerName?: string | null } | null
}

interface RosterPlayer {
  player_id: string
  name: string
  birth_year: number | null
}

// A pending commit: which question it came from, and whether it is waiting on
// the coach to confirm replacing an existing priority.
interface Commit {
  complaint: string
  confirming: Superseding | null
  focusAreaLabel: string
  running: boolean
  error: string | null
}

export default function ChatPage() {
  usePageView('chat')
  const track = useTracker()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [teamContext, setTeamContext] = useState<any>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [threadsPanelOpen, setThreadsPanelOpen] = useState(false)
  const [startingThread, setStartingThread] = useState(false)
  // Set when migration 020 hasn't been applied — the rail is useless without
  // it, so say why rather than showing an empty list.
  const [threadsUnavailable, setThreadsUnavailable] = useState(false)
  const [roster, setRoster] = useState<RosterPlayer[]>([])
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [commit, setCommit] = useState<Commit | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadChat()
      loadThreads()
      loadRoster()
      loadTeamContext()
    }
  }, [teamId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // No id opens whichever conversation was used last, which is where the
  // coach left off.
  const loadChat = async (id?: string) => {
    try {
      const url = id ? `/api/chat?teamId=${teamId}&threadId=${id}` : `/api/chat?teamId=${teamId}`
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setThreadId(data.threadId)
        setMessages(data.messages || [])
        // A conversation about Charlie stays about Charlie when you reopen it.
        setPlayerId(data.playerId ?? null)
        setCommit(null)
      }
    } catch (error) {
      console.error('Error loading chat:', error)
    } finally {
      setInitialLoading(false)
    }
  }

  const loadThreads = async () => {
    try {
      const response = await fetch(`/api/chat/threads?teamId=${teamId}`)
      const data = await response.json()
      if (data.needsMigration) {
        setThreadsUnavailable(true)
        return
      }
      setThreads(data.threads || [])
    } catch (error) {
      console.error('Error loading conversations:', error)
    }
  }

  const handleSelectThread = (id: string) => {
    if (id === threadId) { setThreadsPanelOpen(false); return }
    setMessages([])
    setThreadId(id)
    setThreadsPanelOpen(false)
    loadChat(id)
  }

  const handleNewThread = async () => {
    // An untitled thread with no messages already in the list is the one they
    // just made — reuse it instead of stacking up empties.
    const empty = threads.find(t => t.message_count === 0)
    if (empty) { handleSelectThread(empty.id); return }

    setStartingThread(true)
    try {
      const response = await fetch('/api/chat/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, playerId }),
      })
      const data = await response.json()
      if (data.thread) {
        setMessages([])
        setThreadId(data.thread.id)
        setThreadsPanelOpen(false)
        await loadThreads()
      }
    } catch (error) {
      console.error('Error starting a new chat:', error)
    } finally {
      setStartingThread(false)
    }
  }

  // ── Committing a priority ────────────────────────────────
  //
  // The button doesn't bookmark the chat reply. It runs the full structured
  // analysis on the original question and saves it as the active priority for
  // that area of the game, which is what starts the three-week loop. Chat
  // answers in ten seconds; this is the deliberate act.

  const selectedPlayer = roster.find(r => r.player_id === playerId)

  const runCommit = async (complaint: string, confirmSupersede: boolean) => {
    setCommit(prev => ({
      complaint,
      confirming: confirmSupersede ? null : prev?.confirming ?? null,
      focusAreaLabel: prev?.focusAreaLabel || '',
      running: true,
      error: null,
    }))

    const playerAge = selectedPlayer?.birth_year
      ? new Date().getFullYear() - selectedPlayer.birth_year
      : undefined

    try {
      const res = await fetch('/api/prescribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          complaint,
          teamId,
          playerId: playerId || undefined,
          playerAge,
          confirmSupersede,
        }),
      })

      // 409 means there is already a priority in this area. The server checks
      // before spending anything on the analysis, so backing out is free.
      if (res.status === 409) {
        const data = await res.json()
        setCommit({
          complaint,
          confirming: data.replacing,
          focusAreaLabel: data.focusAreaLabel || 'this area',
          running: false,
          error: null,
        })
        return
      }

      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const data = await res.json()
        throw new Error(data.error || 'Could not set the priority.')
      }
      if (!res.body) throw new Error('No response from the server')

      // Stream it into the conversation as it is written — a read takes 20-40
      // seconds and a spinner that long reads as broken.
      const liveId = `commit-${Date.now()}`
      setMessages(prev => [
        ...prev,
        { id: liveId, role: 'assistant', content: '', meta: { kind: 'priority' } },
      ])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let markdown = ''
      let meta: any = null

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const sentinelAt = buffer.indexOf(META_SENTINEL)
        markdown = sentinelAt === -1 ? buffer : buffer.slice(0, sentinelAt)

        setMessages(prev =>
          prev.map(m => (m.id === liveId ? { ...m, content: markdown } : m))
        )

        if (sentinelAt !== -1) {
          try {
            meta = JSON.parse(buffer.slice(sentinelAt + META_SENTINEL.length))
          } catch {
            /* the tail is the only part that failed — the analysis still stands */
          }
        }
      }

      if (meta?.error) throw new Error(meta.error)

      // Persist it into the thread so the conversation reads as the whole
      // story: the question, the answer, and the decision.
      const saved = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          role: 'assistant',
          content: markdown,
          meta: {
            kind: 'priority',
            prescriptionId: meta?.prescriptionId || null,
            playerName: selectedPlayer?.name || null,
          },
        }),
      }).then(r => r.json()).catch(() => null)

      setMessages(prev =>
        prev.map(m =>
          m.id === liveId
            ? {
                ...m,
                id: saved?.message?.id || liveId,
                content: markdown,
                meta: {
                  kind: 'priority',
                  prescriptionId: meta?.prescriptionId || null,
                  playerName: selectedPlayer?.name || null,
                },
              }
            : m
        )
      )

      track('prescription_generated', { source: 'chat', from_chat: true })
      setCommit(null)
      loadThreads()
    } catch (error: any) {
      console.error('Commit error:', error)
      setCommit({
        complaint,
        confirming: null,
        focusAreaLabel: '',
        running: false,
        error: error?.message || 'Could not set the priority.',
      })
    }
  }

  // The question a commit is built from is the coach's own words, not the
  // model's answer — the analysis should read the problem, not a summary of a
  // previous read of it.
  const questionBefore = (assistantIndex: number): string | null => {
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content
    }
    return null
  }

  const handleScopeChange = async (nextPlayerId: string | null) => {
    setPlayerId(nextPlayerId)
    setCommit(null)
    if (!threadId) return
    setThreads(prev => prev.map(t => (t.id === threadId ? { ...t, player_id: nextPlayerId } : t)))
    await fetch('/api/chat/threads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, playerId: nextPlayerId }),
    })
  }

  const handleRenameThread = async (id: string, title: string) => {
    setThreads(prev => prev.map(t => (t.id === id ? { ...t, title } : t)))
    await fetch('/api/chat/threads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: id, title }),
    })
  }

  const handleDeleteThread = async (id: string) => {
    const remaining = threads.filter(t => t.id !== id)
    setThreads(remaining)
    await fetch(`/api/chat/threads?threadId=${id}`, { method: 'DELETE' })

    // Deleting the open conversation has to land somewhere — the next most
    // recent, or a clean slate if that was the last one.
    if (id === threadId) {
      setMessages([])
      if (remaining.length > 0) {
        setThreadId(remaining[0].id)
        loadChat(remaining[0].id)
      } else {
        setThreadId(null)
      }
    }
    loadThreads()
  }

  const loadRoster = async () => {
    const { data } = await supabase
      .from('team_players')
      .select('player:players(id, name, birth_year)')
      .eq('team_id', teamId as any)
    const list: RosterPlayer[] = (data || [])
      .map((tp: any) => ({
        player_id: tp.player?.id,
        name: tp.player?.name || '',
        birth_year: tp.player?.birth_year ?? null,
      }))
      .filter((r: RosterPlayer) => r.player_id && r.name)
      .sort((a: RosterPlayer, b: RosterPlayer) => a.name.localeCompare(b.name))
    setRoster(list)
  }

  const loadTeamContext = async () => {
    try {
      const { data: team } = await supabase
        .from('teams')
        .select('*')
        .eq('id', teamId)
        .single()

      const { data: notes } = await supabase
        .from('team_notes')
        .select('*')
        .eq('team_id', teamId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5)

      const { data: players } = await supabase
        .from('team_players')
        .select(`*, player:players(name)`)
        .eq('team_id', teamId)
        .limit(10)

      setTeamContext({
        team,
        notes: notes || [],
        players: players || [],
      })
    } catch (error) {
      console.error('Error loading context:', error)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || !teamId) return

    const userMessage = input.trim()
    setInput('')
    setLoading(true)

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessage,
    }
    setMessages(prev => [...prev, tempUserMsg])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          message: userMessage,
          history: messages.slice(-6),
          // Without this the server falls back to "most recent thread", which
          // is the wrong one the moment you switch conversations.
          threadId,
          playerId,
        }),
      })

      const data = await response.json().catch(() => ({}))

      // Show what actually failed. Replacing every server error with one
      // generic sentence is why a broken chat took a week to diagnose — the
      // reason was already in the response body and got thrown away here.
      if (!response.ok) {
        throw new Error(data?.error || `The server returned ${response.status}.`)
      }

      const assistantMsg: Message = {
        id: data.id || `temp-${Date.now()}-assistant`,
        role: 'assistant',
        content: data.message,
        memory_suggestions: data.memory_suggestions,
      }

      setMessages(prev => [
        ...prev.filter(m => m.id !== tempUserMsg.id),
        { ...tempUserMsg, id: data.user_message_id },
        assistantMsg,
      ])

      // The first message is what names the conversation, and every message
      // reorders the list, so the rail refreshes on each exchange.
      if (data.threadId) setThreadId(data.threadId)
      loadThreads()
    } catch (error: any) {
      console.error('Chat error:', error)
      const detail = error?.message ? `\n\n\`${error.message}\`` : ''
      setMessages(prev => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `That didn't go through. Try again — if it keeps happening, this is why:${detail}`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    )
  }

  const activeThread = threads.find(t => t.id === threadId) || null
  const railProps = {
    threads,
    activeId: threadId,
    busy: startingThread,
    onSelect: handleSelectThread,
    onNew: handleNewThread,
    onRename: handleRenameThread,
    onDelete: handleDeleteThread,
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-12rem)]">
      {/* Conversations — a rail on desktop, a sheet on phones */}
      {!threadsUnavailable && (
        <aside className="hidden lg:flex w-64 shrink-0 bg-white rounded-lg shadow flex-col overflow-hidden">
          <ChatThreadList {...railProps} />
        </aside>
      )}

      {threadsPanelOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setThreadsPanelOpen(false)} />
          <div className="relative bg-white w-72 max-w-[85vw] h-full shadow-xl flex flex-col">
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              <span className="font-semibold text-gray-900 text-sm">Conversations</span>
              <button onClick={() => setThreadsPanelOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <ChatThreadList {...railProps} />
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 bg-white rounded-lg shadow flex flex-col min-w-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
          {!threadsUnavailable && (
            <button
              onClick={() => setThreadsPanelOpen(true)}
              className="lg:hidden text-gray-500 hover:text-gray-800 shrink-0"
              aria-label="Conversations"
            >
              <Menu size={20} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-gray-900 truncate">
              {activeThread?.title || 'CoachAI'}
            </h2>
            {activeThread?.title && (
              <p className="text-xs text-gray-500">CoachAI</p>
            )}
          </div>

          {/* Who this conversation is about. Answers get read from that
              player's own history rather than an average of the roster, and
              it's what a committed priority attaches to. */}
          {roster.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Users size={15} className="text-gray-400 hidden sm:block" />
              <select
                value={playerId || ''}
                onChange={e => handleScopeChange(e.target.value || null)}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white max-w-[9rem] sm:max-w-none"
              >
                <option value="">Whole team</option>
                {roster.map(r => (
                  <option key={r.player_id} value={r.player_id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}
          {!threadsUnavailable && (
            <button
              onClick={handleNewThread}
              disabled={startingThread}
              className="lg:hidden text-sm text-blue-600 hover:text-blue-700 shrink-0 disabled:opacity-50"
            >
              New
            </button>
          )}
        </div>

        {threadsUnavailable && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
            Separate conversations need migration 020 applied in Supabase. Until then this stays a single chat.
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 mt-12">
              <div className="text-4xl mb-4">⚾</div>
              <p className="text-lg mb-2">
                {threads.length > 1 ? 'New conversation' : 'Ask me anything about coaching'}
              </p>
              <div className="text-sm space-y-1">
                <p>"What drills can help fix an uppercut swing?"</p>
                <p>"Why are we falling apart in games?"</p>
                <p>"How do I help a struggling player?"</p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message, index) => {
                const isPriority = message.meta?.kind === 'priority'
                const sourceQuestion = message.role === 'assistant' ? questionBefore(index) : null
                // Only offer the commit on the newest answer. Older ones are
                // history, and a stack of identical buttons up the thread is
                // noise rather than a choice.
                const canCommit =
                  message.role === 'assistant' &&
                  !isPriority &&
                  !message.id.startsWith('error-') &&
                  index === messages.length - 1 &&
                  !!sourceQuestion &&
                  !loading

                return (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-3xl rounded-lg ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white px-4 py-3'
                        : isPriority
                          ? 'bg-white border-2 border-red-200 px-4 py-3 w-full'
                          : 'bg-gray-100 text-gray-900 px-4 py-3'
                    }`}
                  >
                    {isPriority && (
                      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-red-100">
                        <Target className="text-red-600 shrink-0" size={18} />
                        <span className="font-semibold text-gray-900 text-sm">
                          {message.meta?.playerName
                            ? `${message.meta.playerName}'s priority`
                            : 'Team priority'}
                        </span>
                        <span className="text-xs text-gray-500 ml-auto">
                          Check-in in 3 weeks
                        </span>
                      </div>
                    )}

                    {message.role === 'assistant' ? (
                      <ChatMessageContent content={message.content} role={message.role} />
                    ) : (
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    )}

                    {isPriority && message.meta?.prescriptionId && (
                      <Link
                        href={`/dashboard/prescribe?teamId=${teamId}`}
                        className="mt-3 inline-flex items-center gap-1 text-sm text-red-700 hover:text-red-800"
                      >
                        See all active priorities <ExternalLink size={13} />
                      </Link>
                    )}

                    {/* The commit. Not a bookmark of this reply — it runs the
                        full structured read on the original question and puts
                        it on the three-week clock. */}
                    {canCommit && (
                      <div className="mt-3 pt-3 border-t border-gray-300">
                        {commit?.error && (
                          <p className="text-sm text-red-700 mb-2">{commit.error}</p>
                        )}
                        <button
                          onClick={() => runCommit(sourceQuestion!, false)}
                          disabled={commit?.running}
                          className="inline-flex items-center gap-2 px-3 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                        >
                          {commit?.running
                            ? <Loader2 className="animate-spin" size={15} />
                            : <Target size={15} />}
                          {commit?.running ? 'Working on the read…' : 'Make this the priority'}
                        </button>
                        <p className="text-xs text-gray-500 mt-2">
                          Runs the full read on {selectedPlayer?.name || 'the team'}, sets it as
                          the priority, and checks back in three weeks to see whether it moved.
                        </p>
                      </div>
                    )}

                    {/* Memory Suggestions */}
                    {message.memory_suggestions &&
                      Object.keys(message.memory_suggestions).some(
                        k => message.memory_suggestions[k]?.length > 0
                      ) && (
                        <div className="mt-3 pt-3 border-t border-gray-300">
                          <div className="text-xs text-gray-600 mb-2">Save to memory:</div>
                          <div className="flex flex-wrap gap-1">
                            {message.memory_suggestions.team_issues?.map((issue: any, idx: number) => (
                              <button
                                key={idx}
                                className="text-xs bg-white px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                              >
                                💾 {issue.title}
                              </button>
                            ))}
                            {message.memory_suggestions.player_notes?.map((note: any, idx: number) => (
                              <button
                                key={idx}
                                className="text-xs bg-white px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                              >
                                💾 {note.player_name}: {note.note.slice(0, 30)}...
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
                )
              })}
              {/* Raised before anything is written, and before the analysis
                  costs anything — the server checks and returns 409 first. */}
              {commit?.confirming && (
                <SupersedeConfirm
                  replacing={commit.confirming}
                  focusAreaLabel={commit.focusAreaLabel}
                  busy={commit.running}
                  onConfirm={() => runCommit(commit.complaint, true)}
                  onCancel={() => setCommit(null)}
                />
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 p-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Ask me anything about coaching..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Context Sidebar */}
      {teamContext && (
        <aside className="hidden xl:block w-80 shrink-0 bg-white rounded-lg shadow p-6 overflow-y-auto">
          <h3 className="font-semibold text-gray-900 mb-4">Team Context</h3>

          <div className="space-y-4 text-sm">
            <div>
              <div className="text-xs text-gray-500 mb-1">Team</div>
              <div className="font-medium">{teamContext.team?.name}</div>
              <div className="text-gray-600">
                {teamContext.team?.age_group} • {teamContext.team?.skill_level}
              </div>
            </div>

            {teamContext.team?.primary_goals?.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Goals</div>
                <div className="flex flex-wrap gap-1">
                  {teamContext.team.primary_goals.map((goal: string) => (
                    <span
                      key={goal}
                      className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs capitalize"
                    >
                      {goal}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {teamContext.notes?.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Active Issues</div>
                <div className="space-y-2">
                  {teamContext.notes.slice(0, 3).map((note: any) => (
                    <div
                      key={note.id}
                      className="text-xs text-gray-700 border-l-2 border-yellow-400 pl-2"
                    >
                      {note.note}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {teamContext.players?.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">
                  Players ({teamContext.players.length})
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  {teamContext.players.slice(0, 5).map((tp: any) => (
                    <div key={tp.id}>{tp.player?.name}</div>
                  ))}
                  {teamContext.players.length > 5 && (
                    <div className="text-gray-400">+{teamContext.players.length - 5} more</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* The "this will clear your conversation" warning used to live here.
          Starting a new chat no longer destroys anything, so there is nothing
          left to warn about. */}
    </div>
  )
}
