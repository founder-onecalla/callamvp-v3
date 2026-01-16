-- Add inbound audio health tracking column
-- This tracks whether we're receiving audio from the remote party
ALTER TABLE calls ADD COLUMN IF NOT EXISTS inbound_audio_health JSONB DEFAULT '{}'::jsonb;

-- Comment on the column
COMMENT ON COLUMN calls.inbound_audio_health IS 'Tracks inbound audio health: transcription_started, self_transcripts_received, remote_transcripts_received, timestamps, leg values received';
