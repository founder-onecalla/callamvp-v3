import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Call, Transcription, CallEvent } from '../lib/types'

export interface CallWithTranscripts extends Call {
  transcriptions: Transcription[]
  call_events?: CallEvent[]
}

interface UseCallHistoryReturn {
  calls: CallWithTranscripts[]
  totalCount: number
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
}

const PAGE_SIZE = 20

/**
 * Call History Hook - Deterministic, Paginated
 *
 * Contract:
 * - Ordering: newest first by created_at, with id as tie-breaker
 * - Pagination: cursor-based using (created_at, id) for stability
 * - Count: total count of ended calls from a separate query
 * - Realtime: smart updates (insert new, update in place) - no full refetch
 */
export function useCallHistory(): UseCallHistoryReturn {
  const [calls, setCalls] = useState<CallWithTranscripts[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)

  // Track cursor for pagination (last item's created_at and id)
  const cursorRef = useRef<{ created_at: string; id: string } | null>(null)
  // Track if initial load is done
  const initialLoadDone = useRef(false)

  // Fetch total count of ended calls
  const fetchCount = useCallback(async () => {
    try {
      const { count, error: countError } = await supabase
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ended')

      if (countError) throw countError
      setTotalCount(count ?? 0)
    } catch (err) {
      console.error('Failed to fetch call count:', err)
    }
  }, [])

  // Fetch a page of calls
  const fetchPage = useCallback(async (cursor: { created_at: string; id: string } | null = null) => {
    // Build query with deterministic ordering
    // Order by created_at DESC, then id DESC for tie-breaking
    let query = supabase
      .from('calls')
      .select(`
        *,
        transcriptions (*),
        call_events (*)
      `)
      .eq('status', 'ended')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE)

    // Apply cursor for pagination (fetch items BEFORE the cursor)
    if (cursor) {
      // Items where (created_at < cursor.created_at) OR (created_at = cursor.created_at AND id < cursor.id)
      query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
    }

    const { data, error: queryError } = await query

    if (queryError) throw queryError

    // Sort nested data
    const processedCalls = (data || []).map((call: Call & { transcriptions: Transcription[], call_events?: CallEvent[] }) => ({
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

    return processedCalls
  }, [])

  // Initial load
  const fetchInitial = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      cursorRef.current = null

      const [callsData] = await Promise.all([
        fetchPage(null),
        fetchCount()
      ])

      setCalls(callsData)
      setHasMore(callsData.length === PAGE_SIZE)

      // Set cursor to last item
      if (callsData.length > 0) {
        const last = callsData[callsData.length - 1]
        cursorRef.current = { created_at: last.created_at, id: last.id }
      }

      initialLoadDone.current = true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load call history')
    } finally {
      setIsLoading(false)
    }
  }, [fetchPage, fetchCount])

  // Load more (pagination)
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !cursorRef.current) return

    try {
      setIsLoadingMore(true)
      const newCalls = await fetchPage(cursorRef.current)

      if (newCalls.length > 0) {
        setCalls(prev => [...prev, ...newCalls])
        setHasMore(newCalls.length === PAGE_SIZE)

        // Update cursor
        const last = newCalls[newCalls.length - 1]
        cursorRef.current = { created_at: last.created_at, id: last.id }
      } else {
        setHasMore(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more calls')
    } finally {
      setIsLoadingMore(false)
    }
  }, [fetchPage, isLoadingMore, hasMore])

  // Initial fetch
  useEffect(() => {
    fetchInitial()
  }, [fetchInitial])

  // Realtime subscription - smart updates, no full refetch
  useEffect(() => {
    const channel = supabase
      .channel('call-history-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
        },
        (payload) => {
          // New call added - if it's ended, add to top of list
          const newCall = payload.new as Call
          if (newCall.status === 'ended') {
            setCalls(prev => {
              // Avoid duplicates
              if (prev.some(c => c.id === newCall.id)) return prev
              // Add to top with empty transcriptions (will be populated on next view)
              const callWithTranscripts: CallWithTranscripts = {
                ...newCall,
                transcriptions: [],
                call_events: []
              }
              return [callWithTranscripts, ...prev]
            })
            setTotalCount(prev => prev + 1)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
        },
        (payload) => {
          const updatedCall = payload.new as Call
          const oldCall = payload.old as Partial<Call>

          // If call just became 'ended', add it to the list
          if (updatedCall.status === 'ended' && oldCall.status !== 'ended') {
            setCalls(prev => {
              if (prev.some(c => c.id === updatedCall.id)) {
                // Already in list, just update
                return prev.map(c => c.id === updatedCall.id
                  ? { ...c, ...updatedCall }
                  : c
                )
              }
              // Add to top
              const callWithTranscripts: CallWithTranscripts = {
                ...updatedCall,
                transcriptions: [],
                call_events: []
              }
              return [callWithTranscripts, ...prev]
            })
            setTotalCount(prev => prev + 1)
          } else {
            // Update in place
            setCalls(prev => prev.map(c =>
              c.id === updatedCall.id
                ? { ...c, ...updatedCall }
                : c
            ))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return {
    calls,
    totalCount,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh: fetchInitial,
  }
}
