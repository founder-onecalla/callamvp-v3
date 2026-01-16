import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Conversation } from '../lib/types'
import { useAuth } from '../lib/AuthContext'

interface UseConversationsReturn {
  conversations: Conversation[]
  currentConversationId: string | null
  isLoading: boolean
  createConversation: () => Promise<string>
  selectConversation: (id: string | null) => void
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  updateConversationTitle: (id: string, firstMessage: string) => Promise<void>
}

export function useConversations(): UseConversationsReturn {
  const { user } = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Fetch conversations on mount and when user changes
  useEffect(() => {
    if (!user) {
      setConversations([])
      setIsLoading(false)
      return
    }

    const fetchConversations = async () => {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })

      if (!error && data) {
        setConversations(data)
      }
      setIsLoading(false)
    }

    fetchConversations()

    // Subscribe to changes
    const channel = supabase
      .channel('conversations-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchConversations()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const createConversation = useCallback(async (): Promise<string> => {
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('conversations')
      .insert({
        user_id: user.id,
        title: 'New Chat',
      } as unknown as never)
      .select()
      .single()

    if (error) throw error

    const conv = data as unknown as Conversation
    setCurrentConversationId(conv.id)
    return conv.id
  }, [user])

  const selectConversation = useCallback((id: string | null) => {
    setCurrentConversationId(id)
  }, [])

  const deleteConversation = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)

    if (error) throw error

    // If we deleted the current conversation, clear selection
    if (currentConversationId === id) {
      setCurrentConversationId(null)
    }
  }, [currentConversationId])

  const renameConversation = useCallback(async (id: string, title: string) => {
    const { error } = await supabase
      .from('conversations')
      .update({ title, updated_at: new Date().toISOString() } as unknown as never)
      .eq('id', id)

    if (error) throw error
  }, [])

  // Auto-generate title from first message
  const updateConversationTitle = useCallback(async (id: string, firstMessage: string) => {
    // Truncate to first 50 chars
    const title = firstMessage.length > 50
      ? firstMessage.substring(0, 47) + '...'
      : firstMessage

    await renameConversation(id, title)
  }, [renameConversation])

  return {
    conversations,
    currentConversationId,
    isLoading,
    createConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
    updateConversationTitle,
  }
}
