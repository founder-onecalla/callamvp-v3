-- Enable required extensions
create extension if not exists "uuid-ossp";

-- Calls table
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  telnyx_call_id text,
  phone_number text not null,
  status text default 'pending' check (status in ('pending', 'ringing', 'answered', 'ended')),
  direction text default 'outbound' check (direction in ('outbound', 'inbound')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz default now()
);

-- Transcriptions table
create table public.transcriptions (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls(id) on delete cascade not null,
  speaker text check (speaker in ('user', 'remote')),
  content text not null,
  confidence float,
  created_at timestamptz default now()
);

-- Messages table (chat history)
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  call_id uuid references public.calls(id) on delete set null,
  created_at timestamptz default now()
);

-- Indexes
create index calls_user_id_idx on public.calls(user_id);
create index calls_status_idx on public.calls(status);
create index calls_telnyx_call_id_idx on public.calls(telnyx_call_id);
create index transcriptions_call_id_idx on public.transcriptions(call_id);
create index messages_user_id_idx on public.messages(user_id);

-- Enable Row Level Security
alter table public.calls enable row level security;
alter table public.transcriptions enable row level security;
alter table public.messages enable row level security;

-- RLS Policies for calls
create policy "Users can view their own calls"
  on public.calls for select
  using (auth.uid() = user_id);

create policy "Users can insert their own calls"
  on public.calls for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own calls"
  on public.calls for update
  using (auth.uid() = user_id);

-- Service role can do anything (for edge functions)
create policy "Service role has full access to calls"
  on public.calls for all
  using (auth.jwt() ->> 'role' = 'service_role');

-- RLS Policies for transcriptions
create policy "Users can view transcriptions for their calls"
  on public.transcriptions for select
  using (
    exists (
      select 1 from public.calls
      where calls.id = transcriptions.call_id
      and calls.user_id = auth.uid()
    )
  );

create policy "Service role has full access to transcriptions"
  on public.transcriptions for all
  using (auth.jwt() ->> 'role' = 'service_role');

-- RLS Policies for messages
create policy "Users can view their own messages"
  on public.messages for select
  using (auth.uid() = user_id);

create policy "Users can insert their own messages"
  on public.messages for insert
  with check (auth.uid() = user_id);

create policy "Service role has full access to messages"
  on public.messages for all
  using (auth.jwt() ->> 'role' = 'service_role');

-- Enable realtime for these tables
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.transcriptions;
