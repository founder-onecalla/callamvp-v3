import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import type { UserSettings } from '../lib/types'

// Helper to access user_settings table
// The table isn't in our generated types yet, so we use type assertions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const userSettingsFrom = () => (supabase as any).from('user_settings')

interface UseSettingsReturn {
  settings: UserSettings | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  updateSettings: (updates: Partial<UserSettings>) => Promise<boolean>
  deleteAllCallHistory: () => Promise<boolean>
  exportCallHistory: () => Promise<string | null>
}

/**
 * Hook for managing user settings
 * - Fetches settings on mount (creates default if missing)
 * - Provides updateSettings for saving changes
 * - Single source of truth for user preferences
 */
export function useSettings(): UseSettingsReturn {
  const { user } = useAuth()
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch settings on mount
  const fetchSettings = useCallback(async () => {
    if (!user) {
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // Try to get existing settings
      const { data, error: fetchError } = await userSettingsFrom()
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (fetchError) {
        // If not found, create default settings
        if ((fetchError as { code?: string }).code === 'PGRST116') {
          const { data: newData, error: insertError } = await userSettingsFrom()
            .insert({ user_id: user.id })
            .select()
            .single()

          if (insertError) throw insertError
          setSettings(newData as UserSettings)
        } else {
          throw fetchError
        }
      } else {
        setSettings(data as UserSettings)
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err)
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }, [user])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  // Update settings
  const updateSettings = useCallback(async (updates: Partial<UserSettings>): Promise<boolean> => {
    if (!user || !settings) return false

    try {
      setIsSaving(true)
      setError(null)

      const { data, error: updateError } = await userSettingsFrom()
        .update(updates)
        .eq('user_id', user.id)
        .select()
        .single()

      if (updateError) throw updateError

      setSettings(data as UserSettings)
      return true
    } catch (err) {
      console.error('Failed to update settings:', err)
      setError(err instanceof Error ? err.message : 'Failed to save settings')
      return false
    } finally {
      setIsSaving(false)
    }
  }, [user, settings])

  // Delete all call history
  const deleteAllCallHistory = useCallback(async (): Promise<boolean> => {
    if (!user) return false

    try {
      setError(null)

      // First, get all call IDs for this user
      const { data: userCalls, error: fetchError } = await supabase
        .from('calls')
        .select('id')
        .eq('user_id', user.id) as { data: { id: string }[] | null; error: Error | null }

      if (fetchError) throw fetchError

      if (userCalls && userCalls.length > 0) {
        const callIds = userCalls.map(c => c.id)

        // Delete transcriptions first (foreign key constraint)
        const { error: transcriptError } = await supabase
          .from('transcriptions')
          .delete()
          .in('call_id', callIds)

        if (transcriptError) throw transcriptError

        // Delete call events
        const { error: eventsError } = await supabase
          .from('call_events')
          .delete()
          .in('call_id', callIds)

        if (eventsError) throw eventsError

        // Delete calls
        const { error: callsError } = await supabase
          .from('calls')
          .delete()
          .eq('user_id', user.id)

        if (callsError) throw callsError
      }

      return true
    } catch (err) {
      console.error('Failed to delete call history:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete call history')
      return false
    }
  }, [user])

  // Export call history as JSON
  const exportCallHistory = useCallback(async (): Promise<string | null> => {
    if (!user) return null

    try {
      const { data: calls, error: callsError } = await supabase
        .from('calls')
        .select(`
          *,
          transcriptions (*),
          call_events (*)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (callsError) throw callsError

      const exportData = {
        exported_at: new Date().toISOString(),
        user_id: user.id,
        calls: calls || []
      }

      return JSON.stringify(exportData, null, 2)
    } catch (err) {
      console.error('Failed to export call history:', err)
      setError(err instanceof Error ? err.message : 'Failed to export call history')
      return null
    }
  }, [user])

  return {
    settings,
    isLoading,
    isSaving,
    error,
    updateSettings,
    deleteAllCallHistory,
    exportCallHistory,
  }
}

// Helper to get the caller name based on settings
export function getCallerName(settings: UserSettings | null): string | null {
  if (!settings) return null

  switch (settings.default_caller_mode) {
    case 'SELF_NAME':
      return settings.display_name
    case 'OTHER_NAME':
      return settings.default_caller_other_name
    case 'DONT_DISCLOSE':
      return null
    default:
      return settings.display_name
  }
}

// Helper to check if sensitive confirmation is required
export function requiresSensitiveConfirmation(settings: UserSettings | null): boolean {
  return settings?.require_sensitive_confirmation ?? true
}
