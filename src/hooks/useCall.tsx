import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Call, Transcription, CallEvent, CallCardData, RecapStatus } from '../lib/types'
import { useAuth } from '../lib/AuthContext'

// ============================================================================
// RECAP STATE MODEL - Single source of truth
// ============================================================================
// The recap_status field on the call record is the ONLY source of truth.
// UI is a pure function of this state. No local overrides.
// ============================================================================

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
  // Recap state - derived from call record, not local state
  recapStatus: RecapStatus | null
  callCardData: CallCardData | null
  retrySummary: () => Promise<void>
}

const CallContext = createContext<CallContextType | null>(null)

// Polling intervals with backoff
const POLL_INTERVALS = [2000, 3000, 5000, 8000, 10000] // 2s, 3s, 5s, 8s, 10s

// ============================================================================
// STALENESS THRESHOLDS - For reconciliation safeguard
// ============================================================================
const STALE_UPDATE_THRESHOLD_MS = 30_000 // 30 seconds without update = potentially stale
const MAX_ACTIVE_CALL_DURATION_MS = 120_000 // 2 minutes = definitely check DB

export function CallProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [currentCall, setCurrentCall] = useState<Call | null>(null)
  const [callConversationId, setCallConversationId] = useState<string | null>(null)
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
  const [callEvents, setCallEvents] = useState<CallEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [callCardData, setCallCardData] = useState<CallCardData | null>(null)

  // Track if we've already initiated recap for this call
  const recapInitiatedRef = useRef<string | null>(null)
  // Polling state
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollAttemptRef = useRef(0)
  
  // ============================================================================
  // RECONCILIATION STATE - Track last update time for staleness detection
  // ============================================================================
  const lastUpdateRef = useRef<number>(Date.now())
  const reconciliationInProgressRef = useRef<boolean>(false)

  // Derive recap status from call record - single source of truth
  const recapStatus: RecapStatus | null = currentCall?.recap_status ?? null

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    pollAttemptRef.current = 0
  }, [])

  // Fetch recap data when status is ready
  const fetchRecapData = useCallback(async (callId: string) => {
    try {
      const response = await supabase.functions.invoke('call-summary', {
        body: { call_id: callId, fetch_only: true },
      })

      if (response.data?.callCardData) {
        setCallCardData(response.data.callCardData)
      }
    } catch (err) {
      console.error('Failed to fetch recap data:', err)
    }
  }, [])

  // Request recap generation
  const requestRecap = useCallback(async (callId: string, isRetry = false) => {
    try {
      // Set to pending state immediately (optimistic)
      setCurrentCall(prev => prev ? {
        ...prev,
        recap_status: 'recap_pending',
        recap_last_attempt_at: new Date().toISOString(),
        recap_attempt_count: (prev.recap_attempt_count || 0) + 1
      } : prev)

      const response = await supabase.functions.invoke('call-summary', {
        body: { call_id: callId, is_retry: isRetry },
      })

      if (response.error) {
        console.error('Recap API error:', response.error)
        // Backend will update the call record with appropriate status
        return
      }

      // Backend returns the updated call card data
      if (response.data?.callCardData) {
        setCallCardData(response.data.callCardData)
      }

      // The real status comes from the call record via realtime subscription
    } catch (err) {
      console.error('Failed to request recap:', err)
    }
  }, [])

  // ============================================================================
  // RECONCILIATION SAFEGUARD - Detect and heal stuck call states
  // ============================================================================
  // If a call appears active but hasn't received updates in 30s, or has been
  // "answered" for >2 minutes, directly query DB to check actual state.
  // This prevents UI from showing "Live Call" for ended calls when Realtime fails.
  // ============================================================================
  const reconcileCallState = useCallback(async () => {
    if (!currentCall || reconciliationInProgressRef.current) return
    
    // Only reconcile active calls (not already ended)
    if (currentCall.status === 'ended' || currentCall.ended_at) return
    
    reconciliationInProgressRef.current = true
    
    try {
      const { data: latestCall, error: fetchError } = await supabase
        .from('calls')
        .select('*')
        .eq('id', currentCall.id)
        .single()
      
      if (fetchError) {
        console.error('[useCall] Reconciliation fetch failed:', fetchError)
        return
      }
      
      const dbCall = latestCall as Call
      
      // INVARIANT CHECK: If DB has ended_at or status='ended', update local state
      if (dbCall.ended_at || dbCall.status === 'ended') {
        console.warn('[useCall] Reconciliation detected ended call - Realtime may have missed update')
        setCurrentCall(dbCall)
        lastUpdateRef.current = Date.now()
        
        // Trigger recap if needed
        if (recapInitiatedRef.current !== dbCall.id) {
          recapInitiatedRef.current = dbCall.id
          await requestRecap(dbCall.id)
        }
      } else if (dbCall.status !== currentCall.status) {
        // Status changed but not to ended - still update
        console.warn('[useCall] Reconciliation detected status change:', currentCall.status, '->', dbCall.status)
        setCurrentCall(dbCall)
        lastUpdateRef.current = Date.now()
      }
    } finally {
      reconciliationInProgressRef.current = false
    }
  }, [currentCall, requestRecap])

  // Retry function exposed to UI
  const retrySummary = useCallback(async () => {
    if (!currentCall) return
    stopPolling()
    recapInitiatedRef.current = currentCall.id
    await requestRecap(currentCall.id, true)
  }, [currentCall, requestRecap, stopPolling])

  // Poll for recap status when pending
  useEffect(() => {
    if (!currentCall || recapStatus !== 'recap_pending') {
      stopPolling()
      return
    }

    // Start polling with backoff
    const poll = async () => {
      pollAttemptRef.current++

      // Fetch latest call status
      const { data: latestCall } = await supabase
        .from('calls')
        .select('*')
        .eq('id', currentCall.id)
        .single()

      const latestStatus = (latestCall as Call | null)?.recap_status
      if (latestStatus && latestStatus !== 'recap_pending') {
        stopPolling()
        // Update will come via realtime subscription
      } else if (pollAttemptRef.current >= 10) {
        // Max 10 attempts (~45 seconds total), then mark as transient failure
        stopPolling()
        setCurrentCall(prev => prev ? {
          ...prev,
          recap_status: 'recap_failed_transient',
          recap_error_code: 'TIMEOUT'
        } : prev)
      }
    }

    // Initial poll
    poll()

    // Set up interval with backoff
    pollIntervalRef.current = setInterval(poll, POLL_INTERVALS[Math.min(pollAttemptRef.current, POLL_INTERVALS.length - 1)])

    return () => stopPolling()
  }, [currentCall?.id, recapStatus, stopPolling])

  // Fetch recap data when status becomes ready
  useEffect(() => {
    if (currentCall && recapStatus === 'recap_ready' && !callCardData) {
      fetchRecapData(currentCall.id)
    }
  }, [currentCall?.id, recapStatus, callCardData, fetchRecapData])

  // Subscribe to call updates
  useEffect(() => {
    if (!currentCall) return

    // Reset update tracker when subscribing to a new call
    lastUpdateRef.current = Date.now()

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
          
          // Track that we received an update (for staleness detection)
          lastUpdateRef.current = Date.now()

          // When call ends, initiate recap if not already done
          if (updatedCall.status === 'ended' && recapInitiatedRef.current !== updatedCall.id) {
            recapInitiatedRef.current = updatedCall.id
            await requestRecap(updatedCall.id)
          }

          // When recap becomes ready, fetch the data
          if (updatedCall.recap_status === 'recap_ready' && !callCardData) {
            await fetchRecapData(updatedCall.id)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentCall, requestRecap, fetchRecapData, callCardData])
  
  // ============================================================================
  // STALENESS DETECTION - Periodic check for stuck call states
  // ============================================================================
  // Every 10 seconds, check if the call appears stale and trigger reconciliation.
  // This is the safety net that prevents "Live Call" from showing forever.
  // ============================================================================
  useEffect(() => {
    if (!currentCall) return
    
    // Only monitor active calls
    if (currentCall.status === 'ended' || currentCall.ended_at) return
    
    const checkStaleness = () => {
      const now = Date.now()
      const timeSinceLastUpdate = now - lastUpdateRef.current
      const callDuration = currentCall.started_at 
        ? now - new Date(currentCall.started_at).getTime()
        : 0
      
      const isStale = timeSinceLastUpdate > STALE_UPDATE_THRESHOLD_MS
      const isTooLong = callDuration > MAX_ACTIVE_CALL_DURATION_MS
      
      if (isStale || isTooLong) {
        console.warn('[useCall] Call appears stale, triggering reconciliation', {
          callId: currentCall.id,
          timeSinceLastUpdate: Math.round(timeSinceLastUpdate / 1000) + 's',
          callDuration: Math.round(callDuration / 1000) + 's',
          isStale,
          isTooLong
        })
        reconcileCallState()
      }
    }
    
    // Check every 10 seconds
    const interval = setInterval(checkStaleness, 10_000)
    
    return () => clearInterval(interval)
  }, [currentCall?.id, currentCall?.status, currentCall?.ended_at, currentCall?.started_at, reconcileCallState])

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
    console.log('[useCall] startCall called with:', { phoneNumber, contextId, purpose, conversationId })
    
    if (!session?.access_token) {
      console.error('[useCall] Not authenticated - no access token')
      setError('Not authenticated')
      throw new Error('Not authenticated')
    }
    
    console.log('[useCall] Session valid, access_token exists')

    setIsLoading(true)
    setError(null)
    setTranscriptions([])
    setCallEvents([])
    setCallCardData(null)
    setCallConversationId(conversationId ?? null)
    recapInitiatedRef.current = null
    stopPolling()

    try {
      console.log('[useCall] Invoking call-start edge function...')
      console.log('[useCall] Phone number:', phoneNumber)
      console.log('[useCall] Purpose:', purpose)
      
      // Wrap in timeout to catch hanging requests
      const invokePromise = supabase.functions.invoke('call-start', {
        body: {
          phone_number: phoneNumber,
          context_id: contextId,
          purpose: purpose,
        },
      })
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out after 30 seconds')), 30000)
      })
      
      const response = await Promise.race([invokePromise, timeoutPromise]) as Awaited<typeof invokePromise>

      console.log('[useCall] call-start response received:', JSON.stringify(response, null, 2))

      if (response.error) {
        console.error('[useCall] Call start API error:', response.error)
        console.error('[useCall] Full error object:', JSON.stringify(response.error, null, 2))
        
        // Try to extract meaningful error message from various formats
        let errorMsg = 'Unable to start call. Please try again.'
        
        // Supabase FunctionsHttpError contains the response body in context
        if (response.error.context) {
          try {
            const contextBody = await response.error.context.json()
            console.error('[useCall] Error context body:', contextBody)
            if (contextBody.error) {
              errorMsg = contextBody.error
            }
          } catch {
            // Try text
            try {
              const contextText = await response.error.context.text()
              console.error('[useCall] Error context text:', contextText)
              const parsed = JSON.parse(contextText)
              if (parsed.error) errorMsg = parsed.error
            } catch {
              // ignore
            }
          }
        } else if (typeof response.error === 'object' && response.error.message) {
          errorMsg = response.error.message
        }
        
        setError(errorMsg)
        throw new Error(errorMsg)
      }

      // Check if backend returned an error in the data
      if (response.data?.error) {
        console.error('[useCall] Call start returned error in data:', response.data.error)
        const errorMsg = response.data.error || 'Call failed to start. Please try again.'
        setError(errorMsg)
        throw new Error(errorMsg)
      }

      if (!response.data?.call) {
        console.error('[useCall] Call start returned no call data:', response.data)
        const errorMsg = 'Call failed to start. Please try again.'
        setError(errorMsg)
        throw new Error(errorMsg)
      }

      console.log('[useCall] Call started successfully:', response.data.call.id)
      // Call started successfully
      setCurrentCall(response.data.call)
    } catch (err) {
      console.error('[useCall] Failed to start call:', err)
      // Preserve specific error messages from backend
      const errorMsg = err instanceof Error && err.message && !err.message.includes('FunctionsHttpError') 
        ? err.message 
        : 'Unable to start call. Please try again.'
      setError(errorMsg)
      setIsLoading(false)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [session, stopPolling])

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
        recapStatus,
        callCardData,
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
