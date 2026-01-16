-- Add recap state columns (single source of truth for recap status)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recap_status TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recap_error_code TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recap_last_attempt_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recap_attempt_count INTEGER DEFAULT 0;

-- Add pipeline checkpoint columns (for debugging call failures)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS pipeline_checkpoints JSONB DEFAULT '{}'::jsonb;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS silence_started_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS reprompt_count INTEGER DEFAULT 0;

-- Create index for recap status queries
CREATE INDEX IF NOT EXISTS idx_calls_recap_status ON calls(recap_status);

-- Add check constraint for valid recap status values
ALTER TABLE calls DROP CONSTRAINT IF EXISTS valid_recap_status;
ALTER TABLE calls ADD CONSTRAINT valid_recap_status CHECK (
  recap_status IS NULL OR
  recap_status IN ('recap_ready', 'recap_pending', 'recap_failed_transient', 'recap_failed_permanent')
);

-- Comment on new columns
COMMENT ON COLUMN calls.recap_status IS 'Single source of truth for recap state: recap_ready, recap_pending, recap_failed_transient, recap_failed_permanent';
COMMENT ON COLUMN calls.recap_error_code IS 'Error code for debugging when recap fails';
COMMENT ON COLUMN calls.pipeline_checkpoints IS 'JSONB object with checkpoint timestamps for debugging call pipeline';
COMMENT ON COLUMN calls.silence_started_at IS 'When the silence watchdog was started (for reprompt detection)';
COMMENT ON COLUMN calls.reprompt_count IS 'Number of times we have reprompted due to silence';
