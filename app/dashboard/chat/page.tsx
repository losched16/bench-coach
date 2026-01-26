'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Send, Loader2, Bookmark, Check, Brain } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  memory_suggestions?: any
}

function ChatPageContent() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [teamContext, setTeamContext] = useState<any>(null)
  const [savedMemories, setSavedMemories] = useState<Set<string>>(new Set())
  const [savedDrills, setSavedDrills] = useState<Set<string>>(new Set())
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [messageToSave, setMessageToSave] = useState<Message | null>(null)
  const [drillTitle, setDrillTitle] = useState('')
  const [drillCategory, setDrillCategory] = useState('general')
  const [savingDrill, setSavingDrill] = useState(false)
  // Memory save modal state
  const [showMemoryModal, setShowMemoryModal] = useState(false)
  const [memoryToSave, setMemoryToSave] = useState<Message | null>(null)
  const [memoryTitle, setMemoryTitle] = useState('')
  const [savingMemory, setSavingMemory] = useState(false)
  const [savedToMemory, setSavedToMemory] = useState<Set<string>>(new Set())
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
        .eq('team_id', teamId!)
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
        .eq('team_id', teamId!)
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
        .eq('team_id', teamId!)
        .limit(10)

      // Load active playbooks
      const { data: playbooks } = await supabase
        .from('player_playbooks')
        .select(`
          id,
          title,
          completed_sessions,
          status,
          player:players(name),
          template:playbook_templates(
            title,
            total_sessions,
            skill_category
          )
        `)
        .eq('team_id', teamId!)
        .eq('status', 'active')

      const formattedPlaybooks = playbooks?.map(pb => ({
        id: pb.id,
        title: pb.template?.title || pb.title,
        player_name: pb.player?.name || 'Whole Team',
        skill_category: pb.template?.skill_category,
        progress: `${Array.isArray(pb.completed_sessions) ? pb.completed_sessions.length : 0}/${pb.template?.total_sessions || 0}`,
        current_day: (Array.isArray(pb.completed_sessions) ? pb.completed_sessions.length : 0) + 1
      })) || []

      setTeamContext({
        team,
        notes: notes || [],
        players: players || [],
        playbooks: formattedPlaybooks,
      })
    } catch (error) {
      console.error('Error loading context:', error)
    }
  }

  const saveTeamIssue = async (issue: { title: string; detail: string }, messageId: string, idx: number) => {
    if (!teamId) return
    
    const memoryKey = `${messageId}-issue-${idx}`
    if (savedMemories.has(memoryKey)) return // Already saved

    try {
      await supabase
        .from('team_notes')
        .insert({
          team_id: teamId,
          title: issue.title,
          note: issue.detail,
          pinned: false,
        })

      setSavedMemories(prev => new Set(prev).add(memoryKey))
      
      // Refresh context to show new note
      loadTeamContext()
    } catch (error) {
      console.error('Error saving team issue:', error)
    }
  }

  const savePlayerNote = async (playerNote: { player_name: string; note: string; type: string }, messageId: string, idx: number) => {
    if (!teamId) return

    const memoryKey = `${messageId}-player-${idx}`
    if (savedMemories.has(memoryKey)) return

    try {
      // Find the player
      const { data: teamPlayers } = await supabase
        .from('team_players')
        .select('player_id, player:players(name)')
        .eq('team_id', teamId!)

      const playerMatch = teamPlayers?.find((tp: any) => 
        tp.player.name.toLowerCase().includes(playerNote.player_name.toLowerCase())
      )

      if (playerMatch) {
        if (playerNote.type === 'trait') {
          await supabase
            .from('player_traits')
            .insert({
              player_id: playerMatch.player_id,
              note: playerNote.note,
            })
        } else {
          await supabase
            .from('player_notes')
            .insert({
              team_id: teamId,
              player_id: playerMatch.player_id,
              note: playerNote.note,
            })
        }

        setSavedMemories(prev => new Set(prev).add(memoryKey))
      }
    } catch (error) {
      console.error('Error saving player note:', error)
    }
  }

  const openSaveModal = (message: Message) => {
    setMessageToSave(message)
    // Try to extract a title from the first line of the message
    const firstLine = message.content.split('\n')[0].replace(/[#*]/g, '').trim()
    setDrillTitle(firstLine.substring(0, 100) || 'Saved Drill')
    setDrillCategory('general')
    setShowSaveModal(true)
  }

  const handleSaveDrill = async () => {
    if (!messageToSave || !teamId || !drillTitle.trim()) return

    setSavingDrill(true)
    try {
      const { error } = await supabase
        .from('saved_drills')
        .insert({
          team_id: teamId,
          title: drillTitle.trim(),
          content: messageToSave.content,
          category: drillCategory,
          source_message_id: messageToSave.id.startsWith('temp-') ? null : messageToSave.id,
        })

      if (error) throw error

      setSavedDrills(prev => new Set(prev).add(messageToSave.id))
      setShowSaveModal(false)
      setMessageToSave(null)
      setDrillTitle('')
    } catch (error) {
      console.error('Error saving drill:', error)
      alert('Failed to save drill')
    } finally {
      setSavingDrill(false)
    }
  }

  const openMemoryModal = (message: Message) => {
    setMemoryToSave(message)
    // Try to extract a title from the first line of the message
    const firstLine = message.content.split('\n')[0].replace(/[#*]/g, '').trim()
    setMemoryTitle(firstLine.substring(0, 100) || 'AI Response')
    setShowMemoryModal(true)
  }

  const handleSaveMemory = async () => {
    if (!memoryToSave || !teamId || !memoryTitle.trim()) return

    setSavingMemory(true)
    try {
      const { error } = await supabase
        .from('team_notes')
        .insert({
          team_id: teamId,
          title: memoryTitle.trim(),
          note: memoryToSave.content,
          pinned: false,
        })

      if (error) throw error

      setSavedToMemory(prev => new Set(prev).add(memoryToSave.id))
      setShowMemoryModal(false)
      setMemoryToSave(null)
      setMemoryTitle('')
      
      // Refresh context to show new note
      loadTeamContext()
    } catch (error) {
      console.error('Error saving to memory:', error)
      alert('Failed to save to memory')
    } finally {
      setSavingMemory(false)
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
                    
                    {/* Save Buttons (assistant messages only) */}
                    {message.role === 'assistant' && (
                      <div className="mt-3 pt-3 border-t border-gray-300 flex items-center space-x-2">
                        {/* Save to Drills */}
                        <button
                          onClick={() => openSaveModal(message)}
                          disabled={savedDrills.has(message.id)}
                          className={`flex items-center space-x-1 text-xs px-3 py-1.5 rounded transition-colors ${
                            savedDrills.has(message.id)
                              ? 'bg-green-100 text-green-700 border border-green-300'
                              : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                          }`}
                        >
                          {savedDrills.has(message.id) ? (
                            <>
                              <Check size={14} />
                              <span>Saved to Drills</span>
                            </>
                          ) : (
                            <>
                              <Bookmark size={14} />
                              <span>Save to Drills</span>
                            </>
                          )}
                        </button>
                        
                        {/* Save to Memory */}
                        <button
                          onClick={() => openMemoryModal(message)}
                          disabled={savedToMemory.has(message.id)}
                          className={`flex items-center space-x-1 text-xs px-3 py-1.5 rounded transition-colors ${
                            savedToMemory.has(message.id)
                              ? 'bg-green-100 text-green-700 border border-green-300'
                              : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
                          }`}
                        >
                          {savedToMemory.has(message.id) ? (
                            <>
                              <Check size={14} />
                              <span>Saved to Memory</span>
                            </>
                          ) : (
                            <>
                              <Brain size={14} />
                              <span>Save to Memory</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                    
                    {/* Memory Suggestions */}
                    {message.memory_suggestions && (
                      Object.keys(message.memory_suggestions).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-300">
                          <div className="text-xs text-gray-600 mb-2">Save to memory:</div>
                          <div className="space-y-1">
                            {/* Team Issues */}
                            {message.memory_suggestions.team_issues?.map((issue: any, idx: number) => {
                              const memoryKey = `${message.id}-issue-${idx}`
                              const isSaved = savedMemories.has(memoryKey)
                              return (
                                <button
                                  key={idx}
                                  onClick={() => saveTeamIssue(issue, message.id, idx)}
                                  disabled={isSaved}
                                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                                    isSaved 
                                      ? 'bg-green-100 border-green-300 text-green-700' 
                                      : 'bg-white border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  {isSaved ? '✓ Saved' : '💾'} {issue.title}
                                </button>
                              )
                            })}
                            {/* Player Notes */}
                            {message.memory_suggestions.player_notes?.map((playerNote: any, idx: number) => {
                              const memoryKey = `${message.id}-player-${idx}`
                              const isSaved = savedMemories.has(memoryKey)
                              return (
                                <button
                                  key={idx}
                                  onClick={() => savePlayerNote(playerNote, message.id, idx)}
                                  disabled={isSaved}
                                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                                    isSaved 
                                      ? 'bg-green-100 border-green-300 text-green-700' 
                                      : 'bg-white border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  {isSaved ? '✓ Saved' : '💾'} {playerNote.player_name}: {playerNote.note.substring(0, 30)}...
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
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
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
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

            {teamContext.playbooks && teamContext.playbooks.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Active Playbooks</div>
                <div className="space-y-2">
                  {teamContext.playbooks.map((pb: any) => (
                    <div key={pb.id} className="text-xs bg-green-50 border border-green-200 rounded p-2">
                      <div className="font-medium text-green-800">{pb.title}</div>
                      <div className="text-green-600">
                        {pb.player_name} • Day {pb.current_day} • {pb.progress}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Save Drill Modal */}
      {showSaveModal && messageToSave && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Save to Drills</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title *
                </label>
                <input
                  type="text"
                  value={drillTitle}
                  onChange={(e) => setDrillTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="e.g., Fly Ball Drills for 8U"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category
                </label>
                <select
                  value={drillCategory}
                  onChange={(e) => setDrillCategory(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="general">General</option>
                  <option value="hitting">Hitting</option>
                  <option value="fielding">Fielding</option>
                  <option value="throwing">Throwing</option>
                  <option value="catching">Catching</option>
                  <option value="baserunning">Baserunning</option>
                  <option value="practice-plan">Practice Plan</option>
                  <option value="game-situations">Game Situations</option>
                </select>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto">
                <div className="text-xs text-gray-500 mb-1">Preview:</div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap">
                  {messageToSave.content.substring(0, 200)}...
                </div>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowSaveModal(false)
                    setMessageToSave(null)
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDrill}
                  disabled={!drillTitle.trim() || savingDrill}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingDrill ? 'Saving...' : 'Save Drill'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save to Memory Modal */}
      {showMemoryModal && memoryToSave && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Brain className="text-purple-600" size={24} />
              <span>Save to AI Memory</span>
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title *
                </label>
                <input
                  type="text"
                  value={memoryTitle}
                  onChange={(e) => setMemoryTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="e.g., Throwing mechanics advice"
                />
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="text-xs text-purple-600 mb-1">This will be saved as a team note:</div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {memoryToSave.content.substring(0, 300)}
                  {memoryToSave.content.length > 300 && '...'}
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Saved memories help the AI give you more personalized advice. You can manage saved memories in the AI Memory page.
              </p>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowMemoryModal(false)
                    setMemoryToSave(null)
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveMemory}
                  disabled={!memoryTitle.trim() || savingMemory}
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingMemory ? 'Saving...' : 'Save to Memory'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="text-gray-600">Loading...</div>}>
      <ChatPageContent />
    </Suspense>
  )
}
