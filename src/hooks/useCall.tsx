import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Call, Transcription, CallEvent } from '../lib/types'
import { useAuth } from '../lib/AuthContext'

interface CallContextType {
  currentCall: Call | null
  transcriptions: Transcription[]
  callEvents: CallEvent[]
  isLoading: boolean
  error: string | null
  startCall: (phoneNumber: string, contextId?: string) => Promise<void>
  hangUp: () => Promise<void>
  sendDtmf: (digits: string) => Promise<void>
  lastSummary: string | null
}

const CallContext = createContext<CallContextType | null>(null)

export function CallProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [currentCall, setCurrentCall] = useState<Call | null>(null)
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
  const [callEvents, setCallEvents] = useState<CallEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

              if (response.data?.summary) {
                setLastSummary(response.data.summary)
              }
            } catch (err) {
              console.error('Failed to get call summary:', err)
            }

            // Clear call after a delay so user can see final state
            setTimeout(() => {
              setCurrentCall(null)
              setCallEvents([])
              setTranscriptions([])
            }, 3000)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentCall?.id])

  // Subscribe to transcriptions
  useEffect(() => {
    if (!currentCall) return

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
          setTranscriptions((prev) => [...prev, payload.new as Transcription])
        }
      )
      .subscribe()

    return () => {
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

  const startCall = useCallback(async (phoneNumber: string, contextId?: string) => {
    console.log('[useCall] startCall invoked with:', { phoneNumber, contextId })
    console.log('[useCall] Session state:', { hasSession: !!session, hasAccessToken: !!session?.access_token })

    if (!session?.access_token) {
      console.error('[useCall] No access token - user not authenticated')
      setError('Not authenticated')
      return
    }

    setIsLoading(true)
    setError(null)
    setTranscriptions([])
    setCallEvents([])
    setLastSummary(null)
    summaryRequestedRef.current = null

    try {
      console.log('[useCall] Calling call-start Edge Function...')
      const response = await supabase.functions.invoke('call-start', {
        body: {
          phone_number: phoneNumber,
          context_id: contextId,
        },
      })

      console.log('[useCall] call-start response:', response)

      if (response.error) {
        console.error('[useCall] call-start error:', response.error)
        throw new Error(response.error.message)
      }

      console.log('[useCall] Call created successfully:', response.data.call)
      setCurrentCall(response.data.call)
    } catch (err) {
      console.error('[useCall] startCall exception:', err)
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
        transcriptions,
        callEvents,
        isLoading,
        error,
        startCall,
        hangUp,
        sendDtmf,
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
