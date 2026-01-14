import { useState, useRef, useEffect } from 'react'
import { useChat } from '../../hooks/useChat'
import { useCall } from '../../hooks/useCall'
import CallCard from './CallCard'

export default function ChatContainer() {
  const { messages, isLoading, error, sendMessage } = useChat()
  const { currentCall } = useCall()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentCall])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const message = input.trim()
    setInput('')
    await sendMessage(message)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Messages Area - Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">
          {/* Empty state */}
          {messages.length === 0 && !currentCall && (
            <div className="text-center py-20">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Hi there</h2>
              <p className="text-gray-500 mb-6">I can help you make phone calls</p>
              <div className="space-y-2 text-sm text-gray-400">
                <p>"Call 555-123-4567"</p>
                <p>"Dial my doctor at 312-555-0100"</p>
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

          {/* Call Card - Inline */}
          {currentCall && (
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

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Bar - Fixed at bottom */}
      <div className="flex-shrink-0 bg-[#f8f8f8] border-t border-gray-200 px-4 py-3">
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex gap-2 items-end">
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message"
              disabled={isLoading}
              className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-full text-[15px] placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="w-9 h-9 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 rounded-full flex items-center justify-center transition-all duration-200 flex-shrink-0"
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
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
  )
}
