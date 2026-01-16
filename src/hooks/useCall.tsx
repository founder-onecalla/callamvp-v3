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
  retryCount: number
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
  const [retryCount, setRetryCount] = useState(0)

  // Track if we've already requested a summary for this call
  const summaryRequestedRef = useRef<string | null>(null)

  // Cache the last successful callCardData - NEVER replace with error
  const lastSuccessfulDataRef = useRef<CallCardData | null>(null)

  // Request summary function (can be called for retry)
  const requestSummary = useCallback(async (callId: string, isRetry = false) => {
    // If we already have successful data for this call, don't risk losing it
    if (lastSuccessfulDataRef.current?.callId === callId && !isRetry) {
      setSummaryState('succeeded')
      setCallCardData(lastSuccessfulDataRef.current)
      return
    }

    setSummaryState('loading')
    setSummaryRequestedAt(Date.now())

    if (isRetry) {
      setRetryCount(prev => prev + 1)
    }

    try {
      const response = await supabase.functions.invoke('call-summary', {
        body: { call_id: callId },
      })

      if (response.error) {
        // Log the actual error for debugging but don't expose to UI
        console.error('Summary API error:', response.error)
        throw new Error('recap_unavailable')
      }

      if (response.data?.callCardData) {
        const data = response.data.callCardData
        // Cache successful data - this is the golden copy
        lastSuccessfulDataRef.current = data
        setCallCardData(data)
        setSummaryState('succeeded')
        setRetryCount(0) // Reset retry count on success
      } else {
        throw new Error('recap_unavailable')
      }

      if (response.data?.summary) {
        setLastSummary(response.data.summary)
      }
    } catch (err) {
      console.error('Failed to get call summary:', err)

      // If we have cached successful data, keep showing it instead of error
      if (lastSuccessfulDataRef.current?.callId === callId) {
        setSummaryState('succeeded')
        setCallCardData(lastSuccessfulDataRef.current)
      } else {
        setSummaryState('failed')
      }
    }
  }, [])

  // Retry summary function
  const retrySummary = useCallback(async () => {
    if (!currentCall) return
    summaryRequestedRef.current = currentCall.id
    await requestSummary(currentCall.id, true)
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
  }, [currentCall, requestSummary])

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
  }, [currentCall])

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
  }, [currentCall])

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
    lastSuccessfulDataRef.current = null // Clear cache for new call
    // Reset summary state
    setSummaryState('idle')
    setSummaryRequestedAt(null)
    setRetryCount(0)

    try {
      const response = await supabase.functions.invoke('call-start', {
        body: {
          phone_number: phoneNumber,
          context_id: contextId,
          purpose: purpose,
        },
      })

      if (response.error) {
        console.error('Call start API error:', response.error)
        const errorMsg = 'Unable to start call. Please try again.'
        setError(errorMsg)
        throw new Error(errorMsg) // Re-throw so caller knows it failed
      }

      if (!response.data?.call) {
        console.error('Call start returned no call data:', response.data)
        const errorMsg = 'Call failed to start. Please try again.'
        setError(errorMsg)
        throw new Error(errorMsg)
      }

      // Call started successfully
      setCurrentCall(response.data.call)
    } catch (err) {
      console.error('Failed to start call:', err)
      const errorMsg = err instanceof Error ? err.message : 'Unable to start call. Please try again.'
      setError(errorMsg)
      setIsLoading(false)
      throw err // Re-throw so caller knows it failed
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
        console.error('Hangup API error:', response.error)
        throw new Error('Unable to end call.')
      }
    } catch (err) {
      console.error('Failed to hang up:', err)
      // Don't show error for hangup - call might already be ended
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
        console.error('DTMF API error:', response.error)
        // Don't show error for DTMF - it's not critical
      }
    } catch (err) {
      console.error('Failed to send DTMF:', err)
      // Don't show error for DTMF - it's not critical
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
        retryCount,
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
