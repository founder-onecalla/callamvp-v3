import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Message } from '../lib/types'
import { useCall } from './useCall'

interface UseChatReturn {
  messages: Message[]
  isLoading: boolean
  error: string | null
  sendMessage: (content: string) => Promise<void>
  clearMessages: () => void
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { startCall, hangUp, sendDtmf, currentCall } = useCall()

  const handleFunctionCall = useCallback(async (name: string, args: Record<string, unknown>) => {
    switch (name) {
      case 'place_call':
        await startCall(args.phone_number as string)
        return `Initiating call to ${args.phone_number}...`
      case 'hang_up_call':
        await hangUp()
        return 'Hanging up the call...'
      case 'send_dtmf':
        await sendDtmf(args.digits as string)
        return `Sent DTMF tones: ${args.digits}`
      default:
        return `Unknown function: ${name}`
    }
  }, [startCall, hangUp, sendDtmf])

  const sendMessage = useCallback(async (content: string) => {
    setIsLoading(true)
    setError(null)

    const userMessage: Message = {
      id: crypto.randomUUID(),
      user_id: '',
      role: 'user',
      content,
      call_id: currentCall?.id ?? null,
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
        },
      })

      if (response.error) {
        throw new Error(response.error.message)
      }

      const { message, function_call } = response.data

      // Handle function calls from the AI
      if (function_call) {
        const functionResult = await handleFunctionCall(
          function_call.name,
          function_call.arguments
        )

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          user_id: '',
          role: 'assistant',
          content: message || functionResult,
          call_id: currentCall?.id ?? null,
          created_at: new Date().toISOString(),
        }

        setMessages((prev) => [...prev, assistantMessage])
      } else if (message) {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          user_id: '',
          role: 'assistant',
          content: message,
          call_id: currentCall?.id ?? null,
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
  }, [])

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
  }
}
