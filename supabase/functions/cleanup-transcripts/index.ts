import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Transcript Retention Cleanup Function
 *
 * Deletes transcriptions older than each user's configured retention period.
 * Can be called via:
 * 1. Supabase cron (pg_cron)
 * 2. External cron service (e.g., Vercel cron, Cloudflare cron)
 * 3. Manual invocation
 *
 * Security: Requires service role key or valid cron secret
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('[cleanup-transcripts] Starting retention cleanup...')

    // Verify authorization - either service role or cron secret
    const authHeader = req.headers.get('Authorization')
    const cronSecret = req.headers.get('x-cron-secret')
    const expectedCronSecret = Deno.env.get('CRON_SECRET')

    // Allow if: service role key OR matching cron secret
    const isServiceRole = authHeader?.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
    const isValidCron = cronSecret && expectedCronSecret && cronSecret === expectedCronSecret

    if (!isServiceRole && !isValidCron) {
      // For local/testing, allow if no auth is set up
      if (!expectedCronSecret) {
        console.log('[cleanup-transcripts] No CRON_SECRET configured, allowing request')
      } else {
        console.error('[cleanup-transcripts] Unauthorized request')
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get all users with retention settings (not 0 = keep forever)
    const { data: usersWithRetention, error: fetchError } = await serviceClient
      .from('user_settings')
      .select('user_id, transcript_retention_days')
      .gt('transcript_retention_days', 0)

    if (fetchError) {
      throw new Error(`Failed to fetch user settings: ${fetchError.message}`)
    }

    console.log(`[cleanup-transcripts] Processing ${usersWithRetention?.length || 0} users with retention settings`)

    let totalDeleted = 0
    const results: Array<{ user_id: string; deleted: number }> = []

    for (const userSetting of usersWithRetention || []) {
      const { user_id, transcript_retention_days } = userSetting
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - transcript_retention_days)

      // Get calls for this user
      const { data: userCalls } = await serviceClient
        .from('calls')
        .select('id')
        .eq('user_id', user_id)

      if (!userCalls || userCalls.length === 0) {
        continue
      }

      const callIds = userCalls.map(c => c.id)

      // Delete old transcriptions
      const { error: deleteError, count } = await serviceClient
        .from('transcriptions')
        .delete()
        .in('call_id', callIds)
        .lt('created_at', cutoffDate.toISOString())
        .select('*', { count: 'exact', head: true })

      if (deleteError) {
        console.error(`[cleanup-transcripts] Error deleting for user ${user_id}:`, deleteError)
        continue
      }

      const deletedCount = count || 0
      if (deletedCount > 0) {
        console.log(`[cleanup-transcripts] Deleted ${deletedCount} transcriptions for user ${user_id}`)
        totalDeleted += deletedCount
        results.push({ user_id, deleted: deletedCount })
      }

      // Also clean up old call_events (optional, for privacy)
      await serviceClient
        .from('call_events')
        .delete()
        .in('call_id', callIds)
        .lt('created_at', cutoffDate.toISOString())
    }

    console.log(`[cleanup-transcripts] Cleanup complete. Total deleted: ${totalDeleted}`)

    return new Response(JSON.stringify({
      success: true,
      total_deleted: totalDeleted,
      users_processed: usersWithRetention?.length || 0,
      details: results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('[cleanup-transcripts] Error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
