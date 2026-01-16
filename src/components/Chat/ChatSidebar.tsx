import { useState } from 'react'
import type { Conversation } from '../../lib/types'

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

export default function ChatSidebar({
  conversations,
  currentConversationId,
  isLoading,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  isOpen,
  onClose,
}: ChatSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

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

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar - narrower on mobile for better UX */}
      <div
        className={`fixed md:relative inset-y-0 left-0 z-50 w-[280px] md:w-72 bg-gray-50 border-r border-gray-200 flex flex-col transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Header with safe area for Dynamic Island */}
        <div className="flex items-center justify-between p-4 pt-safe border-b border-gray-200">
          <div className="pt-3">
            <h2 className="font-semibold text-gray-900">Chats</h2>
          </div>
          <button
            onClick={onNewChat}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
            title="New Chat"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
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
        </div>

        {/* Close button for mobile - positioned below safe area */}
        <button
          onClick={onClose}
          className="md:hidden absolute top-safe right-2 mt-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 hover:text-gray-700"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </>
  )
}
