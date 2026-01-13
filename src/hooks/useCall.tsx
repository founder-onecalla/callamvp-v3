import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Call, Transcription } from '../lib/types'
import { useAuth } from '../lib/AuthContext'

interface CallContextType {
  currentCall: Call | null
  transcriptions: Transcription[]
  isLoading: boolean
  error: string | null
  startCall: (phoneNumber: string) => Promise<void>
  hangUp: () => Promise<void>
  sendDtmf: (digits: string) => Promise<void>
}

const CallContext = createContext<CallContextType | null>(null)

export function CallProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [currentCall, setCurrentCall] = useState<Call | null>(null)
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        (payload) => {
          setCurrentCall(payload.new as Call)
          if ((payload.new as Call).status === 'ended') {
            // Clear call after a delay so user can see final state
            setTimeout(() => setCurrentCall(null), 3000)
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

  const startCall = useCallback(async (phoneNumber: string) => {
    if (!session?.access_token) {
      setError('Not authenticated')
      return
    }

    setIsLoading(true)
    setError(null)
    setTranscriptions([])

    try {
      const response = await supabase.functions.invoke('call-start', {
        body: { phone_number: phoneNumber },
      })

      if (response.error) {
        throw new Error(response.error.message)
      }

      setCurrentCall(response.data.call)
    } catch (err) {
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
        isLoading,
        error,
        startCall,
        hangUp,
        sendDtmf,
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
