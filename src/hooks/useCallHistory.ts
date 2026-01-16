import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Call, Transcription, CallEvent } from '../lib/types'

export interface CallWithTranscripts extends Call {
  transcriptions: Transcription[]
  call_events?: CallEvent[]
}

interface UseCallHistoryReturn {
  calls: CallWithTranscripts[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useCallHistory(limit = 10): UseCallHistoryReturn {
  const [calls, setCalls] = useState<CallWithTranscripts[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCallHistory = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Fetch recent calls with their transcriptions and call events (for agent speech)
      const { data: callsData, error: callsError } = await supabase
        .from('calls')
        .select(`
          *,
          transcriptions (*),
          call_events (*)
        `)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (callsError) throw callsError

      // Sort transcriptions and call_events within each call by created_at
      const callsWithSortedTranscripts = (callsData || []).map((call: Call & { transcriptions: Transcription[], call_events?: CallEvent[] }) => ({
        ...call,
        transcriptions: (call.transcriptions || []).sort(
          (a: Transcription, b: Transcription) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
        call_events: (call.call_events || []).sort(
          (a: CallEvent, b: CallEvent) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      })) as CallWithTranscripts[]

      setCalls(callsWithSortedTranscripts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load call history')
    } finally {
      setIsLoading(false)
    }
  }, [limit])

  // Initial fetch
  useEffect(() => {
    fetchCallHistory()
  }, [fetchCallHistory])

  // Subscribe to new calls and updates
  useEffect(() => {
    const channel = supabase
      .channel('call-history')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'calls',
        },
        () => {
          // Refresh on any call changes
          fetchCallHistory()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchCallHistory])

  return {
    calls,
    isLoading,
    error,
    refresh: fetchCallHistory,
  }
}
