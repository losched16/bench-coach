'use client'

import { useState } from 'react'
import { MessageSquare, Plus, Trash2, Pencil, Check, X, Loader2 } from 'lucide-react'

// The conversation rail. One job: let a coach get back to the pitching chat
// from Tuesday without losing the outfield one they're in right now.

export interface ChatThread {
  id: string
  title: string | null
  last_message_at: string | null
  created_at: string
  message_count: number
  preview: string | null
}

interface Props {
  threads: ChatThread[]
  activeId: string | null
  busy?: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

// "Today" and "Yesterday" are what people actually use to find a conversation;
// past that a date is more useful than "6 days ago".
function whenLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days === 0 && d.getDate() === now.getDate()) return 'Today'
  if (days <= 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'long' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ChatThreadList({
  threads, activeId, busy, onSelect, onNew, onRename, onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const startRename = (t: ChatThread) => {
    setEditingId(t.id)
    setDraft(t.title || '')
    setConfirmDeleteId(null)
  }

  const commitRename = (id: string) => {
    const clean = draft.trim()
    if (clean) onRename(id, clean)
    setEditingId(null)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-200">
        <button
          onClick={onNew}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
        >
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
          New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {threads.length === 0 && (
          <p className="text-xs text-gray-500 px-2 py-4 text-center">
            Your conversations will show up here.
          </p>
        )}

        {threads.map(t => {
          const isActive = t.id === activeId
          const label = t.title || (t.message_count === 0 ? 'New chat' : t.preview || 'Untitled')

          if (editingId === t.id) {
            return (
              <div key={t.id} className="flex items-center gap-1 px-2 py-1.5 bg-white border border-blue-300 rounded-lg">
                <input
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(t.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 min-w-0 text-sm outline-none"
                  maxLength={80}
                />
                <button onClick={() => commitRename(t.id)} className="text-green-600 hover:text-green-700 shrink-0">
                  <Check size={15} />
                </button>
                <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 shrink-0">
                  <X size={15} />
                </button>
              </div>
            )
          }

          if (confirmDeleteId === t.id) {
            return (
              <div key={t.id} className="px-2 py-2 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-800 mb-2">
                  Delete this conversation? The messages are gone for good.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { onDelete(t.id); setConfirmDeleteId(null) }}
                    className="flex-1 text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="flex-1 text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Keep
                  </button>
                </div>
              </div>
            )
          }

          return (
            <div
              key={t.id}
              className={`group rounded-lg transition-colors ${
                isActive ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-100 border border-transparent'
              }`}
            >
              <button
                onClick={() => onSelect(t.id)}
                className="w-full text-left px-2.5 py-2 flex items-start gap-2 min-w-0"
              >
                <MessageSquare
                  size={15}
                  className={`mt-0.5 shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}
                />
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm truncate ${isActive ? 'text-blue-900 font-medium' : 'text-gray-800'}`}>
                    {label}
                  </span>
                  <span className="block text-xs text-gray-500 truncate">
                    {whenLabel(t.last_message_at || t.created_at)}
                    {t.message_count > 0 && ` · ${t.message_count} message${t.message_count === 1 ? '' : 's'}`}
                  </span>
                </span>
              </button>

              {/* Always visible on touch, where there is no hover to reveal them. */}
              <div className="flex gap-1 px-2.5 pb-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => startRename(t)}
                  className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1"
                >
                  <Pencil size={11} /> Rename
                </button>
                <button
                  onClick={() => setConfirmDeleteId(t.id)}
                  className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1 ml-2"
                >
                  <Trash2 size={11} /> Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
