-- Conversations table for chat history
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text default 'New Chat',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add conversation_id to messages
alter table public.messages
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;

-- Index for faster queries
create index if not exists conversations_user_id_idx on public.conversations(user_id);
create index if not exists conversations_updated_at_idx on public.conversations(updated_at desc);
create index if not exists messages_conversation_id_idx on public.messages(conversation_id);

-- Enable RLS
alter table public.conversations enable row level security;

-- RLS Policies for conversations
create policy "Users can view their own conversations"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "Users can insert their own conversations"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own conversations"
  on public.conversations for update
  using (auth.uid() = user_id);

create policy "Users can delete their own conversations"
  on public.conversations for delete
  using (auth.uid() = user_id);

create policy "Service role has full access to conversations"
  on public.conversations for all
  using (auth.jwt() ->> 'role' = 'service_role');

-- Enable realtime
alter publication supabase_realtime add table public.conversations;
