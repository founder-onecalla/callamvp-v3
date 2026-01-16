import { useState } from 'react'
import type { Conversation } from '../../lib/types'
import { useCallHistory, type CallWithTranscripts } from '../../hooks/useCallHistory'

interface ChatSidebarProps {
  conversations: Conversation[]
  currentConversationId: string | null
  isLoading: boolean
  onNewChat: () => void
  onSelectConversation: (id: string | null) => void
  onDeleteConversation: (id: string) => void
  onRenameConversation: (id: string, title: string) => void
  isOpen: boolean
  onClose: () => void
}

type Tab = 'chats' | 'calls'

// Format duration as MM:SS
function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return ''
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

// Status badge for calls
function CallStatusBadge({ outcome }: { outcome: string | null | undefined }) {
  const config: Record<string, { label: string; className: string }> = {
    completed: { label: 'Completed', className: 'bg-green-100 text-green-700' },
    voicemail: { label: 'Voicemail', className: 'bg-purple-100 text-purple-700' },
    busy: { label: 'Busy', className: 'bg-orange-100 text-orange-700' },
    no_answer: { label: 'No answer', className: 'bg-orange-100 text-orange-700' },
    failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
    cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600' },
  }
  const status = config[outcome || ''] || config.completed
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${status.className}`}>
      {status.label}
    </span>
  )
}

// Phone icon
function PhoneIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
    </svg>
  )
}

export default function ChatSidebar({
  conversations,
  currentConversationId,
  isLoading: conversationsLoading,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  isOpen,
  onClose,
}: ChatSidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>('chats')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)

  // Call history hook
  const {
    calls,
    totalCount,
    isLoading: callsLoading,
    isLoadingMore,
    error: callsError,
    hasMore,
    loadMore,
    refresh: refreshCalls
  } = useCallHistory()

  const handleStartRename = (conv: Conversation) => {
    setEditingId(conv.id)
    setEditTitle(conv.title)
    setMenuOpenId(null)
  }

  const handleSaveRename = (id: string) => {
    if (editTitle.trim()) {
      onRenameConversation(id, editTitle.trim())
    }
    setEditingId(null)
  }

  const handleDelete = (id: string) => {
    if (confirm('Delete this conversation?')) {
      onDeleteConversation(id)
    }
    setMenuOpenId(null)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }

  // Get the selected call for details view
  const selectedCall = selectedCallId ? calls.find(c => c.id === selectedCallId) : null

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed md:relative inset-y-0 left-0 z-50 w-[280px] md:w-72 bg-gray-50 border-r border-gray-200 flex flex-col transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Tab Header */}
        <div className="flex-shrink-0 border-b border-gray-200 pt-safe">
          <div className="flex pt-3">
            <button
              onClick={() => setActiveTab('chats')}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'chats'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Chats
            </button>
            <button
              onClick={() => setActiveTab('calls')}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'calls'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Calls {totalCount > 0 && `(${totalCount})`}
            </button>
          </div>
        </div>

        {/* Content based on active tab */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'chats' ? (
            // Chats List
            <>
              {/* New Chat button */}
              <div className="p-2 border-b border-gray-100">
                <button
                  onClick={onNewChat}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-sm font-medium">New Chat</span>
                </button>
              </div>

              {conversationsLoading ? (
                <div className="p-4 text-center text-gray-500">Loading...</div>
              ) : conversations.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  No conversations yet.
                  <br />
                  Start a new chat!
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={`group relative rounded-lg transition-colors ${
                        currentConversationId === conv.id
                          ? 'bg-blue-100'
                          : 'hover:bg-gray-100'
                      }`}
                    >
                      {editingId === conv.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            handleSaveRename(conv.id)
                          }}
                          className="p-2"
                        >
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onBlur={() => handleSaveRename(conv.id)}
                            autoFocus
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                          />
                        </form>
                      ) : (
                        <button
                          onClick={() => onSelectConversation(conv.id)}
                          className="w-full text-left p-3 pr-10"
                        >
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {conv.title}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {formatDate(conv.updated_at)}
                          </div>
                        </button>
                      )}

                      {/* Menu button */}
                      {editingId !== conv.id && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setMenuOpenId(menuOpenId === conv.id ? null : conv.id)
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <circle cx="12" cy="6" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="12" cy="18" r="1.5" />
                            </svg>
                          </button>

                          {/* Dropdown menu */}
                          {menuOpenId === conv.id && (
                            <div className="absolute right-0 top-8 w-32 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                              <button
                                onClick={() => handleStartRename(conv)}
                                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                              >
                                Rename
                              </button>
                              <button
                                onClick={() => handleDelete(conv.id)}
                                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            // Calls List
            <>
              {callsLoading ? (
                // Skeleton loading state
                <div className="p-2 space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="p-3 rounded-lg bg-gray-100 animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
                      <div className="h-3 bg-gray-200 rounded w-20" />
                    </div>
                  ))}
                </div>
              ) : callsError ? (
                // Error state with retry
                <div className="p-4 text-center">
                  <p className="text-sm text-red-500 mb-3">Couldn't load call history</p>
                  <button
                    onClick={refreshCalls}
                    className="px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : calls.length === 0 ? (
                // Empty state
                <div className="p-4 text-center text-gray-500 text-sm">
                  <PhoneIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  No calls yet.
                  <br />
                  Start a chat to make a call!
                </div>
              ) : (
                // Calls list
                <div className="p-2 space-y-1">
                  {calls.map((call) => (
                    <button
                      key={call.id}
                      onClick={() => setSelectedCallId(call.id)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedCallId === call.id
                          ? 'bg-blue-100'
                          : 'hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <PhoneIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {call.phone_number}
                          </span>
                        </div>
                        <CallStatusBadge outcome={call.outcome} />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                        <span>{formatRelativeTime(call.created_at)}</span>
                        {call.duration_seconds && (
                          <>
                            <span>·</span>
                            <span>{formatDuration(call.duration_seconds)}</span>
                          </>
                        )}
                      </div>
                      {/* Show summary preview if available */}
                      {call.summary && (
                        <p className="mt-1.5 text-xs text-gray-600 line-clamp-1">
                          {call.summary}
                        </p>
                      )}
                    </button>
                  ))}

                  {/* Load more button */}
                  {hasMore && (
                    <button
                      onClick={loadMore}
                      disabled={isLoadingMore}
                      className="w-full py-3 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isLoadingMore ? 'Loading...' : 'Load more'}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Close button for mobile */}
        <button
          onClick={onClose}
          className="md:hidden absolute top-safe right-2 mt-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 hover:text-gray-700"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Call Details Drawer */}
      {selectedCall && (
        <CallDetailsDrawer
          call={selectedCall}
          onClose={() => setSelectedCallId(null)}
        />
      )}
    </>
  )
}

// Call Details Drawer Component
function CallDetailsDrawer({
  call,
  onClose
}: {
  call: CallWithTranscripts
  onClose: () => void
}) {
  // Build transcript turns from transcriptions and call_events
  const asrTurns = (call.transcriptions || [])
    .filter(t => t.speaker === 'remote')
    .map(t => ({
      speaker: 'them' as const,
      text: t.content,
      timestamp: t.created_at,
    }))

  const agentTurns = (call.call_events || [])
    .filter(e => e.event_type === 'agent_speech')
    .map(e => ({
      speaker: 'agent' as const,
      text: e.description || '',
      timestamp: e.created_at,
    }))

  const transcriptTurns = [...asrTurns, ...agentTurns]
    .filter(t => t.text && t.text.trim().length > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="font-semibold text-gray-900">{call.phone_number}</h2>
            <p className="text-sm text-gray-500">
              {new Date(call.created_at).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Status & Duration */}
          <div className="flex items-center gap-3">
            <CallStatusBadge outcome={call.outcome} />
            {call.duration_seconds && (
              <span className="text-sm text-gray-600">
                Duration: {formatDuration(call.duration_seconds)}
              </span>
            )}
          </div>

          {/* Summary */}
          {call.summary && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <h3 className="text-sm font-medium text-blue-800 mb-1">Summary</h3>
              <p className="text-sm text-blue-900">{call.summary}</p>
            </div>
          )}

          {/* Transcript */}
          {transcriptTurns.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Transcript</h3>
              <div className="space-y-3">
                {transcriptTurns.map((turn, index) => (
                  <div
                    key={index}
                    className={`flex ${turn.speaker === 'agent' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[85%] px-3 py-2 rounded-xl text-sm ${
                        turn.speaker === 'agent'
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <p className="text-[10px] font-medium opacity-70 mb-0.5">
                        {turn.speaker === 'agent' ? 'OneCalla' : 'Them'}
                      </p>
                      <p>{turn.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {transcriptTurns.length === 0 && !call.summary && (
            <p className="text-center text-gray-500 text-sm py-8">
              No transcript available for this call.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
