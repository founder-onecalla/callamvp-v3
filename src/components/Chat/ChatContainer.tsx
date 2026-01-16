import { useState, useRef, useEffect, useCallback } from 'react'
import { useChat } from '../../hooks/useChat'
import { useCall } from '../../hooks/useCall'
import { useConversations } from '../../hooks/useConversations'
import { useDictation } from '../../hooks/useDictation'
import { useFileUpload, FILE_CONSTRAINTS } from '../../hooks/useFileUpload'
import { useToast } from '../Toast'
import CallCard from './CallCard'
import ChatSidebar from './ChatSidebar'
import AttachmentPreview from './AttachmentPreview'

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

  const { showToast } = useToast()

  const [input, setInput] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isFirstMessage = useRef(true)
  const composerRef = useRef<HTMLDivElement>(null)

  // File upload hook
  const {
    files,
    isUploading,
    addFiles,
    removeFile,
    clearFiles,
    uploadFiles,
  } = useFileUpload({
    onError: (error) => showToast(error, 'error'),
  })

  // Dictation hook
  const {
    isListening,
    isSupported: isDictationSupported,
    interimTranscript,
    toggleListening,
    stopListening,
  } = useDictation({
    onTranscript: (text, isFinal) => {
      if (isFinal) {
        setInput(prev => {
          const trimmedPrev = prev.trim()
          const trimmedText = text.trim()
          if (!trimmedPrev) return trimmedText
          // Append with space
          return `${trimmedPrev} ${trimmedText}`
        })
      }
    },
    onError: (error) => showToast(error, 'error'),
  })

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentCall])

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  // Handle selecting a conversation from sidebar
  const handleSelectConversation = async (id: string | null) => {
    if (id) {
      selectConversation(id)
      await loadConversation(id)
      isFirstMessage.current = false
    } else {
      selectConversation(null)
      clearMessages()
      isFirstMessage.current = true
    }
    setSidebarOpen(false)
  }

  const handleNewChat = async () => {
    selectConversation(null)
    clearMessages()
    clearFiles()
    isFirstMessage.current = true
    setSidebarOpen(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Stop dictation if active
    if (isListening) {
      stopListening()
    }

    const hasText = input.trim().length > 0
    const hasFiles = files.length > 0

    if ((!hasText && !hasFiles) || isLoading || isUploading) return

    const message = input.trim()
    setInput('')

    // Upload files first if any
    let uploadedFiles: typeof files = []
    if (hasFiles) {
      try {
        uploadedFiles = await uploadFiles()
        clearFiles()
      } catch {
        showToast('Failed to upload some files', 'error')
        return
      }
    }

    // Create conversation on first message if none selected
    let convId = currentConversationId
    if (!convId) {
      convId = await createConversation()
    }

    // Build message with attachments (for future use - backend needs to support this)
    // For now, just mention files in the message if attached
    let finalMessage = message
    if (uploadedFiles.length > 0 && !message) {
      const fileNames = uploadedFiles.map(f => f.name).join(', ')
      finalMessage = `[Attached files: ${fileNames}]`
    }

    await sendMessage(finalMessage || 'Hello', convId)

    // Auto-title the conversation from first user message
    if (isFirstMessage.current && convId && message) {
      await updateConversationTitle(convId, message)
      isFirstMessage.current = false
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter sends, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // File input handler
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(e.target.files)
    }
    // Reset input so same file can be selected again
    e.target.value = ''
  }

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set to false if leaving the composer area
    if (!composerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const droppedFiles = e.dataTransfer.files
    if (droppedFiles.length > 0) {
      addFiles(droppedFiles)
    }
  }, [addFiles])

  // Dictation button handler
  const handleDictateClick = () => {
    if (!isDictationSupported) {
      showToast('Dictation is not supported in this browser.', 'error')
      return
    }
    toggleListening()
  }

  const canSend = (input.trim().length > 0 || files.length > 0) && !isLoading && !isUploading

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
        {/* Header */}
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

        {/* Messages Area */}
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

            {/* Call Card */}
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

            {/* Error */}
            {error && (
              <div className="bg-slate-50 border border-slate-200 text-slate-600 px-4 py-3 rounded-xl text-sm" role="alert" aria-live="polite">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Composer */}
        <div 
          ref={composerRef}
          className={`flex-shrink-0 bg-[#f8f8f8] border-t border-gray-200 px-4 pt-3 pb-safe transition-colors ${
            isDragging ? 'bg-blue-50 border-blue-300' : ''
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="max-w-2xl mx-auto pb-3">
            {/* Drag overlay */}
            {isDragging && (
              <div className="mb-2 py-8 border-2 border-dashed border-blue-400 rounded-xl bg-blue-50 text-center">
                <svg className="w-8 h-8 mx-auto text-blue-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-blue-600 font-medium">Drop files here</p>
              </div>
            )}

            {/* Composer container */}
            <div className="bg-white rounded-2xl border border-gray-300 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 overflow-hidden">
              {/* Attachment previews */}
              <AttachmentPreview files={files} onRemove={removeFile} />

              {/* Input row: [ + ] [ textarea ] [ mic ] [ send ] */}
              <form onSubmit={handleSubmit} className="flex items-end gap-1 p-2">
                {/* Upload button */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={FILE_CONSTRAINTS.acceptedExtensions}
                  onChange={handleFileSelect}
                  className="hidden"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors group relative"
                  aria-label="Add files"
                  title="Add files and more"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {/* Tooltip */}
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none hidden md:block">
                    Add files and more
                  </span>
                </button>

                {/* Text input */}
                <div className="flex-1 relative min-w-0">
                  <label htmlFor="chat-input" className="sr-only">Message</label>
                  <textarea
                    ref={inputRef}
                    id="chat-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isListening ? 'Listening...' : 'Message'}
                    disabled={isLoading}
                    rows={1}
                    className="w-full px-3 py-2.5 bg-transparent text-[16px] placeholder-gray-400 focus:outline-none resize-none max-h-[200px] disabled:opacity-50"
                    aria-describedby={isLoading ? 'loading-status' : undefined}
                  />
                  {isLoading && <span id="loading-status" className="sr-only">Sending message...</span>}
                  
                  {/* Interim transcript indicator */}
                  {isListening && interimTranscript && (
                    <div className="absolute left-3 bottom-full mb-1 text-xs text-gray-400 italic">
                      {interimTranscript}
                    </div>
                  )}
                </div>

                {/* Dictation button */}
                <button
                  type="button"
                  onClick={handleDictateClick}
                  className={`w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full transition-colors group relative ${
                    isListening
                      ? 'text-red-500 bg-red-50 hover:bg-red-100'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  aria-label="Dictate"
                  title="Dictate"
                >
                  {/* Mic icon */}
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  {/* Pulsing indicator when listening */}
                  {isListening && (
                    <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  )}
                  {/* Tooltip */}
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none hidden md:block">
                    Dictate
                  </span>
                </button>

                {/* Send button */}
                <button
                  type="submit"
                  disabled={!canSend}
                  className={`w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full transition-all duration-200 ${
                    canSend
                      ? 'bg-blue-500 hover:bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                  aria-label="Send message"
                >
                  {isUploading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
