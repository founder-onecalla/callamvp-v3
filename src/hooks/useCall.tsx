import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Call, Transcription, CallEvent, CallCardData } from '../lib/types'
import { useAuth } from '../lib/AuthContext'

// Summary generation state
export type SummaryState = 'idle' | 'loading' | 'succeeded' | 'failed'

interface CallContextType {
  currentCall: Call | null
  callConversationId: string | null
  transcriptions: Transcription[]
  callEvents: CallEvent[]
  isLoading: boolean
  error: string | null
  startCall: (phoneNumber: string, contextId?: string, purpose?: string, conversationId?: string | null) => Promise<void>
  hangUp: () => Promise<void>
  sendDtmf: (digits: string) => Promise<void>
  callCardData: CallCardData | null
  lastSummary: string | null
  // Summary state tracking
  summaryState: SummaryState
  summaryRequestedAt: number | null
  summaryError: string | null
  retrySummary: () => Promise<void>
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

  // Summary state tracking
  const [summaryState, setSummaryState] = useState<SummaryState>('idle')
  const [summaryRequestedAt, setSummaryRequestedAt] = useState<number | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  // Track if we've already requested a summary for this call
  const summaryRequestedRef = useRef<string | null>(null)

  // Request summary function (can be called for retry)
  const requestSummary = useCallback(async (callId: string) => {
    setSummaryState('loading')
    setSummaryRequestedAt(Date.now())
    setSummaryError(null)

    try {
      const response = await supabase.functions.invoke('call-summary', {
        body: { call_id: callId },
      })

      if (response.error) {
        throw new Error(response.error.message || 'Failed to generate summary')
      }

      if (response.data?.callCardData) {
        setCallCardData(response.data.callCardData)
        setSummaryState('succeeded')
      } else {
        throw new Error('No summary data returned')
      }

      if (response.data?.summary) {
        setLastSummary(response.data.summary)
      }
    } catch (err) {
      console.error('Failed to get call summary:', err)
      setSummaryState('failed')
      setSummaryError(err instanceof Error ? err.message : 'Failed to generate summary')
    }
  }, [])

  // Retry summary function
  const retrySummary = useCallback(async () => {
    if (!currentCall) return
    summaryRequestedRef.current = currentCall.id
    await requestSummary(currentCall.id)
  }, [currentCall, requestSummary])

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
            await requestSummary(updatedCall.id)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentCall?.id, requestSummary])

  // Subscribe to transcriptions via bridge WebSocket (if available) for lower latency
  useEffect(() => {
    if (!currentCall) return

    const bridgeUrl = import.meta.env.VITE_AUDIO_BRIDGE_URL

    let ws: WebSocket | null = null
    if (bridgeUrl) {
      try {
        const wsUrl = `${bridgeUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/frontend?call_id=${currentCall.id}`
        ws = new WebSocket(wsUrl)

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.event === 'transcript') {
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

        ws.onclose = () => {}
      } catch (err) {
        console.error('[useCall] Failed to connect to bridge:', err)
      }
    }

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
    setCallConversationId(conversationId ?? null)
    summaryRequestedRef.current = null
    // Reset summary state
    setSummaryState('idle')
    setSummaryRequestedAt(null)
    setSummaryError(null)

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
        summaryState,
        summaryRequestedAt,
        summaryError,
        retrySummary,
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
