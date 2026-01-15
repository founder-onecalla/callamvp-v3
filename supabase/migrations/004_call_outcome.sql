-- Add outcome and summary fields to calls table
alter table public.calls add column if not exists outcome text;
alter table public.calls add column if not exists amd_result text;
alter table public.calls add column if not exists summary text;
alter table public.calls add column if not exists duration_seconds integer;

-- Update the speaker constraint to include 'agent' (for AI voice agent)
alter table public.transcriptions drop constraint if exists transcriptions_speaker_check;
alter table public.transcriptions add constraint transcriptions_speaker_check
  check (speaker in ('user', 'remote', 'agent'));

-- Index for fetching call history
create index if not exists calls_created_at_idx on public.calls(created_at desc);
