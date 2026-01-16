import { useState, useRef, useEffect } from 'react'
import { useChat } from '../../hooks/useChat'
import { useCall } from '../../hooks/useCall'
import { useConversations } from '../../hooks/useConversations'
import CallCard from './CallCard'
import CallHistory from './CallHistory'
import ChatSidebar from './ChatSidebar'

export default function ChatContainer() {
  const { messages, isLoading, error, sendMessage, clearMessages, loadConversation } = useChat()
  const { currentCall, callConversationId } = useCall()
  const {
    conversations,
    currentConversationId,
    isLoading: conversationsLoading,
    createConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
    updateConversationTitle,
  } = useConversations()

  const [input, setInput] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isFirstMessage = useRef(true)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentCall])

  // Handle selecting a conversation from sidebar
  const handleSelectConversation = async (id: string | null) => {
    if (id) {
      // Loading an existing conversation - fetch messages from DB
      selectConversation(id)
      await loadConversation(id)
      isFirstMessage.current = false
    } else {
      // Starting fresh (null = no conversation)
      selectConversation(null)
      clearMessages()
      isFirstMessage.current = true
    }
    setSidebarOpen(false)
  }

  const handleNewChat = async () => {
    selectConversation(null)
    clearMessages()
    isFirstMessage.current = true
    setSidebarOpen(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const message = input.trim()
    setInput('')

    // Create conversation on first message if none selected
    let convId = currentConversationId
    if (!convId) {
      convId = await createConversation()
      // Note: createConversation sets currentConversationId internally
      // We don't load from DB here - we already have the message locally
    }

    await sendMessage(message, convId)

    // Auto-title the conversation from first user message
    if (isFirstMessage.current && convId) {
      await updateConversationTitle(convId, message)
      isFirstMessage.current = false
    }
  }

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <ChatSidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        isLoading={conversationsLoading}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={deleteConversation}
        onRenameConversation={renameConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header with menu button - 44px touch targets for mobile */}
        <header className="flex-shrink-0 bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2" role="banner">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
            className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="font-semibold text-gray-900 truncate flex-1">
            {currentConversationId
              ? conversations.find((c) => c.id === currentConversationId)?.title || 'Chat'
              : 'New Chat'}
          </h1>
          <button
            onClick={handleNewChat}
            aria-label="Start new chat"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </header>

        {/* Messages Area - Scrollable */}
        <main className="flex-1 overflow-y-auto" role="main" aria-label="Chat messages">
          <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">
            {/* Empty state */}
            {messages.length === 0 && !currentCall && (
              <div className="text-center py-20">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Hi there</h2>
                <p className="text-gray-500 mb-6">I can help you make phone calls</p>
                <div className="space-y-2 text-sm text-gray-400">
                  <p>"Call Xfinity about my internet"</p>
                  <p>"Make a reservation at a restaurant"</p>
                  <p>"Call my doctor's office"</p>
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.map((message, index) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} message-bubble`}
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div
                  className={`max-w-[75%] px-4 py-2.5 ${
                    message.role === 'user'
                      ? 'bg-blue-500 text-white rounded-[20px] rounded-br-[4px]'
                      : 'bg-[#e9e9eb] text-gray-900 rounded-[20px] rounded-bl-[4px]'
                  }`}
                >
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            ))}

            {/* Call Card - Only show in the conversation where the call was made */}
            {currentCall && callConversationId === currentConversationId && (
              <div className="flex justify-start message-bubble">
                <CallCard />
              </div>
            )}

            {/* Typing indicator */}
            {isLoading && (
              <div className="flex justify-start message-bubble">
                <div className="bg-[#e9e9eb] rounded-[20px] rounded-bl-[4px] px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
                  </div>
                </div>
              </div>
            )}

            {/* Error - user-friendly, not alarming */}
            {error && (
              <div className="bg-slate-50 border border-slate-200 text-slate-600 px-4 py-3 rounded-xl text-sm" role="alert" aria-live="polite">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Call History */}
        <CallHistory />

        {/* Input Bar - Fixed at bottom with safe area for home indicator */}
        <div className="flex-shrink-0 bg-[#f8f8f8] border-t border-gray-200 px-4 pt-3 pb-safe">
          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex gap-2 items-end pb-3" aria-label="Send message">
            <div className="flex-1 relative">
              <label htmlFor="chat-input" className="sr-only">Message</label>
              <input
                id="chat-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message"
                disabled={isLoading}
                aria-describedby={isLoading ? 'loading-status' : undefined}
                className="w-full px-4 py-3 bg-white border border-gray-300 rounded-full text-[16px] placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
              {isLoading && <span id="loading-status" className="sr-only">Sending message...</span>}
            </div>
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              aria-label="Send message"
              className="w-11 h-11 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 rounded-full flex items-center justify-center transition-all duration-200 flex-shrink-0"
            >
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 12h14M12 5l7 7-7 7"
                />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
