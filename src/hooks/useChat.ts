import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Message } from '../lib/types'
import { useCall } from './useCall'

interface UseChatReturn {
  messages: Message[]
  isLoading: boolean
  error: string | null
  sendMessage: (content: string, conversationId?: string | null) => Promise<void>
  clearMessages: () => void
  loadConversation: (conversationId: string) => Promise<void>
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { startCall, hangUp, sendDtmf, currentCall, lastSummary } = useCall()

  // Track context_id for pre-call intelligence
  const callContextRef = useRef<string | null>(null)

  // Track which summaries we've already added to messages
  const addedSummariesRef = useRef<Set<string>>(new Set())

  // When a new summary comes in, add it as a message
  useEffect(() => {
    if (lastSummary && !addedSummariesRef.current.has(lastSummary)) {
      addedSummariesRef.current.add(lastSummary)

      const summaryMessage: Message = {
        id: crypto.randomUUID(),
        user_id: '',
        role: 'assistant',
        content: lastSummary,
        call_id: null,
        conversation_id: null,
        created_at: new Date().toISOString(),
      }

      setMessages((prev) => [...prev, summaryMessage])
    }
  }, [lastSummary])

  const handleFunctionCall = useCallback(async (
    name: string,
    args: Record<string, unknown>,
    functionResult?: { success: boolean; data?: unknown },
    conversationId?: string | null
  ) => {
    switch (name) {
      case 'place_call': {
        // Include context_id if one was created during info gathering
        const contextId = args.context_id as string || callContextRef.current
        const purpose = args.purpose as string | undefined
        await startCall(args.phone_number as string, contextId || undefined, purpose, conversationId)
        callContextRef.current = null // Reset after call starts
        return `Initiating call to ${args.phone_number}...`
      }
      case 'hang_up_call':
        await hangUp()
        callContextRef.current = null
        return 'Hanging up the call...'
      case 'send_dtmf':
        await sendDtmf(args.digits as string)
        return `Sent DTMF tones: ${args.digits}`
      case 'create_call_context':
        // Store the context_id for when we place the call
        if (functionResult?.success && functionResult.data) {
          const data = functionResult.data as { context_id: string }
          callContextRef.current = data.context_id
        }
        return null // Backend handles the response
      case 'save_memory':
      case 'save_contact':
      case 'lookup_contact':
        // These are handled by the backend, just return null
        return null
      default:
        return `Unknown function: ${name}`
    }
  }, [startCall, hangUp, sendDtmf])

  const sendMessage = useCallback(async (content: string, conversationId?: string | null) => {
    setIsLoading(true)
    setError(null)

    const userMessage: Message = {
      id: crypto.randomUUID(),
      user_id: '',
      role: 'user',
      content,
      call_id: currentCall?.id ?? null,
      conversation_id: conversationId ?? null,
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMessage])

    try {
      const response = await supabase.functions.invoke('chat', {
        body: {
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          current_call_id: currentCall?.id,
          conversation_id: conversationId,
        },
      })

      if (response.error) {
        throw new Error(response.error.message)
      }

      const { message, function_call, function_result } = response.data

      // Handle function calls from the AI
      if (function_call) {
        const functionResultText = await handleFunctionCall(
          function_call.name,
          function_call.arguments,
          function_result,
          conversationId  // Pass conversationId so calls are tied to this conversation
        )

        // Use message from AI, or fallback to function result text
        const displayMessage = message || functionResultText

        if (displayMessage) {
          const assistantMessage: Message = {
            id: crypto.randomUUID(),
            user_id: '',
            role: 'assistant',
            content: displayMessage,
            call_id: currentCall?.id ?? null,
            conversation_id: conversationId ?? null,
            created_at: new Date().toISOString(),
          }

          setMessages((prev) => [...prev, assistantMessage])
        }
      } else if (message) {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          user_id: '',
          role: 'assistant',
          content: message,
          call_id: currentCall?.id ?? null,
          conversation_id: conversationId ?? null,
          created_at: new Date().toISOString(),
        }

        setMessages((prev) => [...prev, assistantMessage])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setIsLoading(false)
    }
  }, [messages, currentCall, handleFunctionCall])

  const clearMessages = useCallback(() => {
    setMessages([])
    callContextRef.current = null
    addedSummariesRef.current.clear()
  }, [])

  const loadConversation = useCallback(async (conversationId: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (fetchError) throw fetchError

      setMessages(data || [])
      addedSummariesRef.current.clear()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation')
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    loadConversation,
  }
}
