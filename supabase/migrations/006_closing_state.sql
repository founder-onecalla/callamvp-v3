-- Add closing state columns for mutual goodbye mechanism
alter table public.calls
  add column closing_state text default 'active' check (closing_state in ('active', 'closing_said')),
  add column closing_started_at timestamptz;

-- Index for finding calls in closing state
create index calls_closing_state_idx on public.calls(closing_state) where closing_state = 'closing_said';
