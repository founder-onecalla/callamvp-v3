-- Call events table for tracking live call activity (IVR actions, status changes, etc.)
create table public.call_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls(id) on delete cascade not null,
  event_type text not null, -- 'status_change', 'dtmf_sent', 'ivr_navigation', 'transcription', 'error'
  description text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Index for fast lookups by call_id
create index call_events_call_id_idx on public.call_events(call_id);
create index call_events_created_at_idx on public.call_events(created_at);

-- Enable RLS
alter table public.call_events enable row level security;

-- RLS Policies - users can view events for their own calls
create policy "Users can view their own call events"
  on public.call_events for select
  using (
    call_id in (
      select id from public.calls where user_id = auth.uid()
    )
  );

create policy "Service role full access to call events"
  on public.call_events for all
  using (auth.jwt() ->> 'role' = 'service_role');

-- Enable realtime for call_events (for live updates)
alter publication supabase_realtime add table public.call_events;
