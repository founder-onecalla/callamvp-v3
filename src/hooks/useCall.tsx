import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Call, Transcription, CallEvent, CallCardData } from '../lib/types'
import { useAuth } from '../lib/AuthContext'

interface CallContextType {
  currentCall: Call | null
  callConversationId: string | null  // Which conversation this call belongs to
  transcriptions: Transcription[]
  callEvents: CallEvent[]
  isLoading: boolean
  error: string | null
  startCall: (phoneNumber: string, contextId?: string, purpose?: string, conversationId?: string | null) => Promise<void>
  hangUp: () => Promise<void>
  sendDtmf: (digits: string) => Promise<void>
  callCardData: CallCardData | null  // Structured call card data after call ends
  lastSummary: string | null  // Kept for backward compatibility
}

const CallContext = createContext<CallContextType | null>(null)

export function CallProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [currentCall, setCurrentCall] = useState<Call | null>(null)
  const [callConversationId, setCallConversationId] = useState<string | null>(null)
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
  const [callEvents, setCallEvents] = useState<CallEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [callCardData, setCallCardData] = useState<CallCardData | null>(null)
  const [lastSummary, setLastSummary] = useState<string | null>(null)

  // Track if we've already requested a summary for this call
  const summaryRequestedRef = useRef<string | null>(null)

  // Subscribe to call updates
  useEffect(() => {
    if (!currentCall) return

    const channel = supabase
      .channel(`call-${currentCall.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `id=eq.${currentCall.id}`,
        },
        async (payload) => {
          const updatedCall = payload.new as Call
          setCurrentCall(updatedCall)

          // When call ends, request summary
          if (updatedCall.status === 'ended' && summaryRequestedRef.current !== updatedCall.id) {
            summaryRequestedRef.current = updatedCall.id

            try {
              const response = await supabase.functions.invoke('call-summary', {
                body: { call_id: updatedCall.id },
              })

              if (response.data?.callCardData) {
                setCallCardData(response.data.callCardData)
              }
              if (response.data?.summary) {
                setLastSummary(response.data.summary)
              }
            } catch (err) {
              console.error('Failed to get call summary:', err)
            }

            // Don't auto-clear - let user review the call card with transcript
            // User can dismiss it manually via the dismiss button or by starting a new chat
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentCall?.id])

  // Subscribe to transcriptions via bridge WebSocket (if available) for lower latency
  // Falls back to Supabase Realtime for reliability
  useEffect(() => {
    if (!currentCall) return

    const bridgeUrl = import.meta.env.VITE_AUDIO_BRIDGE_URL

    // If bridge URL is configured, connect for real-time transcripts
    let ws: WebSocket | null = null
    if (bridgeUrl) {
      try {
        const wsUrl = `${bridgeUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/frontend?call_id=${currentCall.id}`
        ws = new WebSocket(wsUrl)

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.event === 'transcript') {
              // Add transcript with a generated ID since it comes from WebSocket
              const transcript: Transcription = {
                id: crypto.randomUUID(),
                call_id: currentCall.id,
                speaker: data.speaker,
                content: data.text,
                confidence: null,
                created_at: new Date().toISOString(),
              }
              setTranscriptions((prev) => [...prev, transcript])
            } else if (data.event === 'error') {
              console.error('[useCall] Bridge error:', data.message)
            }
          } catch (err) {
            console.error('[useCall] Failed to parse bridge message:', err)
          }
        }

        ws.onerror = (err) => {
          console.error('[useCall] Bridge WebSocket error:', err)
        }

        ws.onclose = () => {
          // WebSocket closed
        }
      } catch (err) {
        console.error('[useCall] Failed to connect to bridge:', err)
      }
    }

    // Always subscribe to Supabase Realtime as backup
    // (bridge also stores transcripts in DB, so duplicates are filtered by ID)
    const channel = supabase
      .channel(`transcriptions-${currentCall.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'transcriptions',
          filter: `call_id=eq.${currentCall.id}`,
        },
        (payload) => {
          const newTranscript = payload.new as Transcription
          // Avoid duplicates - check if we already have this transcript
          setTranscriptions((prev) => {
            if (prev.some(t => t.id === newTranscript.id)) {
              return prev
            }
            return [...prev, newTranscript]
          })
        }
      )
      .subscribe()

    return () => {
      if (ws) {
        ws.close()
      }
      supabase.removeChannel(channel)
    }
  }, [currentCall?.id])

  // Subscribe to call events (for live status)
  useEffect(() => {
    if (!currentCall) return

    const channel = supabase
      .channel(`call-events-${currentCall.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_events',
          filter: `call_id=eq.${currentCall.id}`,
        },
        (payload) => {
          setCallEvents((prev) => [...prev, payload.new as CallEvent])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentCall?.id])

  const startCall = useCallback(async (phoneNumber: string, contextId?: string, purpose?: string, conversationId?: string | null) => {
    if (!session?.access_token) {
      setError('Not authenticated')
      return
    }

    setIsLoading(true)
    setError(null)
    setTranscriptions([])
    setCallEvents([])
    setCallCardData(null)
    setLastSummary(null)
    setCallConversationId(conversationId ?? null)  // Track which conversation owns this call
    summaryRequestedRef.current = null

    try {
      const response = await supabase.functions.invoke('call-start', {
        body: {
          phone_number: phoneNumber,
          context_id: contextId,
          purpose: purpose,
        },
      })

      if (response.error) {
        throw new Error(response.error.message)
      }

      setCurrentCall(response.data.call)
    } catch (err) {
      console.error('Failed to start call:', err)
      setError(err instanceof Error ? err.message : 'Failed to start call')
    } finally {
      setIsLoading(false)
    }
  }, [session])

  const hangUp = useCallback(async () => {
    if (!currentCall) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await supabase.functions.invoke('call-hangup', {
        body: { call_id: currentCall.id },
      })

      if (response.error) {
        throw new Error(response.error.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to hang up')
    } finally {
      setIsLoading(false)
    }
  }, [currentCall])

  const sendDtmf = useCallback(async (digits: string) => {
    if (!currentCall) return

    setError(null)

    try {
      const response = await supabase.functions.invoke('call-dtmf', {
        body: { call_id: currentCall.id, digits },
      })

      if (response.error) {
        throw new Error(response.error.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send DTMF')
    }
  }, [currentCall])

  return (
    <CallContext.Provider
      value={{
        currentCall,
        callConversationId,
        transcriptions,
        callEvents,
        isLoading,
        error,
        startCall,
        hangUp,
        sendDtmf,
        callCardData,
        lastSummary,
      }}
    >
      {children}
    </CallContext.Provider>
  )
}

export function useCall() {
  const context = useContext(CallContext)
  if (!context) {
    throw new Error('useCall must be used within a CallProvider')
  }
  return context
}
