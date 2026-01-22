'use client'

import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Send, Loader2 } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  memory_suggestions?: any
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [teamContext, setTeamContext] = useState<any>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  useEffect(() => {
    if (teamId) {
      loadChat()
      loadTeamContext()
    }
  }, [teamId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadChat = async () => {
    try {
      // Get or create chat thread for this team
      let { data: thread } = await supabase
        .from('chat_threads')
        .select('id')
        .eq('team_id', teamId)
        .single()

      if (!thread) {
        const { data: newThread } = await supabase
          .from('chat_threads')
          .insert({ team_id: teamId })
          .select()
          .single()
        thread = newThread
      }

      if (thread) {
        const { data: msgs } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('thread_id', thread.id)
          .order('created_at', { ascending: true })

        if (msgs) {
          setMessages(msgs as any)
        }
      }
    } catch (error) {
      console.error('Error loading chat:', error)
    }
  }

  const loadTeamContext = async () => {
    try {
      // Load team with goals
      const { data: team } = await supabase
        .from('teams')
        .select('*')
        .eq('id', teamId)
        .single()

      // Load recent notes
      const { data: notes } = await supabase
        .from('team_notes')
        .select('*')
        .eq('team_id', teamId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5)

      // Load players
      const { data: players } = await supabase
        .from('team_players')
        .select(`
          *,
          player:players(name)
        `)
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

    // Add user message to UI
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessage,
    }
    setMessages(prev => [...prev, tempUserMsg])

    try {
      // Send to API
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          message: userMessage,
          history: messages.slice(-6),
        }),
      })

      if (!response.ok) throw new Error('Failed to send message')

      const data = await response.json()

      // Add assistant message
      const assistantMsg: Message = {
        id: data.id || `temp-${Date.now()}-assistant`,
        role: 'assistant',
        content: data.message,
        memory_suggestions: data.memory_suggestions,
      }

      setMessages(prev => [...prev.filter(m => m.id !== tempUserMsg.id), 
        { ...tempUserMsg, id: data.user_message_id },
        assistantMsg
      ])

    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex space-x-6 h-[calc(100vh-12rem)]">
      {/* Chat Area */}
      <div className="flex-1 bg-white rounded-lg shadow flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 mt-12">
              <div className="text-4xl mb-4">⚾</div>
              <p className="text-lg mb-2">Ask me anything about coaching</p>
              <div className="text-sm space-y-1">
                <p>"What should we work on at practice?"</p>
                <p>"Why are we falling apart in games?"</p>
                <p>"How do I help a struggling player?"</p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-3xl px-4 py-3 rounded-lg ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{message.content}</div>
                    
                    {/* Memory Suggestions */}
                    {message.memory_suggestions && (
                      <div className="mt-3 pt-3 border-t border-gray-300">
                        <div className="text-xs text-gray-600 mb-2">Save to memory:</div>
                        {/* Show save buttons for memory suggestions */}
                        <div className="space-y-1">
                          {message.memory_suggestions.team_issues?.map((issue: any, idx: number) => (
                            <button
                              key={idx}
                              className="text-xs bg-white px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                            >
                              💾 {issue.title}
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
          <div className="flex space-x-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Ask me anything about coaching..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Context Sidebar */}
      {teamContext && (
        <aside className="w-80 bg-white rounded-lg shadow p-6 overflow-y-auto">
          <h3 className="font-semibold text-gray-900 mb-4">Team Context</h3>
          
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-xs text-gray-500 mb-1">Team</div>
              <div className="font-medium">{teamContext.team.name}</div>
              <div className="text-gray-600">
                {teamContext.team.age_group} • {teamContext.team.skill_level}
              </div>
            </div>

            {teamContext.team.primary_goals && teamContext.team.primary_goals.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Goals</div>
                <div className="flex flex-wrap gap-1">
                  {teamContext.team.primary_goals.map((goal: string) => (
                    <span key={goal} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs capitalize">
                      {goal}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {teamContext.notes.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Active Issues</div>
                <div className="space-y-2">
                  {teamContext.notes.slice(0, 3).map((note: any) => (
                    <div key={note.id} className="text-xs text-gray-700 border-l-2 border-yellow-400 pl-2">
                      {note.note}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {teamContext.players.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Players ({teamContext.players.length})</div>
                <div className="text-xs text-gray-600 space-y-1">
                  {teamContext.players.slice(0, 5).map((tp: any) => (
                    <div key={tp.id}>{tp.player.name}</div>
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
    </div>
  )
}
