-- ============================================================================
-- TRANSCRIPT RETENTION ENFORCEMENT
-- Scheduled cleanup of old transcripts based on user settings
-- ============================================================================

-- Function to enforce transcript retention for all users
CREATE OR REPLACE FUNCTION enforce_transcript_retention()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER := 0;
  user_record RECORD;
BEGIN
  -- Loop through users with retention settings (not 0 = keep forever)
  FOR user_record IN
    SELECT user_id, transcript_retention_days
    FROM user_settings
    WHERE transcript_retention_days > 0
  LOOP
    -- Delete old transcriptions for this user
    WITH deleted AS (
      DELETE FROM transcriptions t
      WHERE t.call_id IN (
        SELECT c.id FROM calls c
        WHERE c.user_id = user_record.user_id
      )
      AND t.created_at < NOW() - (user_record.transcript_retention_days || ' days')::INTERVAL
      RETURNING *
    )
    SELECT deleted_count + COUNT(*) INTO deleted_count FROM deleted;

    -- Also delete orphaned call_events older than retention (optional, for privacy)
    DELETE FROM call_events e
    WHERE e.call_id IN (
      SELECT c.id FROM calls c
      WHERE c.user_id = user_record.user_id
    )
    AND e.created_at < NOW() - (user_record.transcript_retention_days || ' days')::INTERVAL;

  END LOOP;

  -- Log the cleanup
  RAISE NOTICE 'Transcript retention cleanup: deleted % transcriptions', deleted_count;

  RETURN deleted_count;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION enforce_transcript_retention() TO service_role;

-- ============================================================================
-- SCHEDULED CLEANUP via pg_cron (if available)
-- Runs daily at 3 AM UTC
-- ============================================================================

-- Check if pg_cron extension is available and create the schedule
DO $$
BEGIN
  -- Try to enable pg_cron if not already enabled
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;

  -- Schedule the retention cleanup to run daily at 3 AM UTC
  -- Delete existing schedule first to make this idempotent
  PERFORM cron.unschedule('transcript-retention-cleanup');
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron not available, skipping schedule creation';
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron not available, skipping schedule creation';
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not unschedule existing job: %', SQLERRM;
END;
$$;

DO $$
BEGIN
  -- Create new schedule
  PERFORM cron.schedule(
    'transcript-retention-cleanup',
    '0 3 * * *',  -- Daily at 3 AM UTC
    'SELECT enforce_transcript_retention()'
  );
  RAISE NOTICE 'Scheduled transcript-retention-cleanup to run daily at 3 AM UTC';
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron not available - manual cleanup required';
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not create cron schedule: %', SQLERRM;
END;
$$;

-- ============================================================================
-- MANUAL INVOCATION
-- If pg_cron is not available, call this via edge function or external cron:
-- SELECT enforce_transcript_retention();
-- ============================================================================
