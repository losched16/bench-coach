'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Send, Loader2, Menu, X } from 'lucide-react'
import { ChatMessageContent } from '@/components/ChatMessageContent'
import { ChatThreadList, ChatThread } from '@/components/ChatThreadList'
import { usePageView } from '@/lib/tracking'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  memory_suggestions?: any
}

export default function ChatPage() {
  usePageView('chat')
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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadChat()
      loadThreads()
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
        body: JSON.stringify({ teamId }),
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
              {activeThread?.title || 'AI Coach'}
            </h2>
            {activeThread?.title && (
              <p className="text-xs text-gray-500">AI Coach</p>
            )}
          </div>
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
              {messages.map(message => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-3xl rounded-lg ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white px-4 py-3'
                        : 'bg-gray-100 text-gray-900 px-4 py-3'
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      <ChatMessageContent content={message.content} role={message.role} />
                    ) : (
                      <div className="whitespace-pre-wrap">{message.content}</div>
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
              ))}
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
