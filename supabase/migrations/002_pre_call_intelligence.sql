-- User memories (auto-saved info like name, address, account numbers)
create table public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  key text not null,
  value text not null,
  category text default 'general', -- personal, utility, healthcare, restaurant, etc.
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, key)
);

-- User contacts (saved phone numbers)
create table public.user_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  phone_number text not null,
  type text default 'personal', -- personal, business, service, healthcare
  company text, -- for business/service contacts
  notes text,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- IVR navigation paths (system-wide knowledge base)
create table public.ivr_paths (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  department text, -- e.g., "tech_support", "billing", "general"
  phone_number text not null,
  menu_path jsonb not null default '[]', -- Array of {prompt, action, note}
  required_info jsonb default '[]', -- Array of required fields for this path
  operating_hours text,
  notes text,
  last_verified timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Call context (stores gathered info for active calls)
create table public.call_contexts (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade not null,
  intent_category text, -- utility, healthcare, personal, scheduling, restaurant
  intent_purpose text, -- tech_support, appointment, reservation, etc.
  company_name text,
  gathered_info jsonb default '{}', -- All collected info for this call
  ivr_path_id uuid references public.ivr_paths(id),
  status text default 'gathering', -- gathering, ready, in_call, completed
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index user_memories_user_id_idx on public.user_memories(user_id);
create index user_memories_key_idx on public.user_memories(key);
create index user_memories_category_idx on public.user_memories(category);
create index user_contacts_user_id_idx on public.user_contacts(user_id);
create index user_contacts_name_idx on public.user_contacts(name);
create index ivr_paths_company_idx on public.ivr_paths(company_name);
create index call_contexts_call_id_idx on public.call_contexts(call_id);
create index call_contexts_user_id_idx on public.call_contexts(user_id);

-- Enable RLS
alter table public.user_memories enable row level security;
alter table public.user_contacts enable row level security;
alter table public.ivr_paths enable row level security;
alter table public.call_contexts enable row level security;

-- RLS Policies for user_memories
create policy "Users can view their own memories"
  on public.user_memories for select
  using (auth.uid() = user_id);

create policy "Users can insert their own memories"
  on public.user_memories for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own memories"
  on public.user_memories for update
  using (auth.uid() = user_id);

create policy "Users can delete their own memories"
  on public.user_memories for delete
  using (auth.uid() = user_id);

create policy "Service role full access to memories"
  on public.user_memories for all
  using (auth.jwt() ->> 'role' = 'service_role');

-- RLS Policies for user_contacts
create policy "Users can view their own contacts"
  on public.user_contacts for select
  using (auth.uid() = user_id);

create policy "Users can insert their own contacts"
  on public.user_contacts for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own contacts"
  on public.user_contacts for update
  using (auth.uid() = user_id);

create policy "Users can delete their own contacts"
  on public.user_contacts for delete
  using (auth.uid() = user_id);

create policy "Service role full access to contacts"
  on public.user_contacts for all
  using (auth.jwt() ->> 'role' = 'service_role');

-- RLS Policies for ivr_paths (read-only for users, full for service role)
create policy "Anyone can read IVR paths"
  on public.ivr_paths for select
  using (true);

create policy "Service role full access to IVR paths"
  on public.ivr_paths for all
  using (auth.jwt() ->> 'role' = 'service_role');

-- RLS Policies for call_contexts
create policy "Users can view their own call contexts"
  on public.call_contexts for select
  using (auth.uid() = user_id);

create policy "Users can insert their own call contexts"
  on public.call_contexts for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own call contexts"
  on public.call_contexts for update
  using (auth.uid() = user_id);

create policy "Service role full access to call contexts"
  on public.call_contexts for all
  using (auth.jwt() ->> 'role' = 'service_role');

-- Enable realtime for call_contexts
alter publication supabase_realtime add table public.call_contexts;

-- Insert some initial IVR paths for common companies
insert into public.ivr_paths (company_name, department, phone_number, menu_path, required_info, operating_hours, notes) values
('Xfinity', 'tech_support', '+18009346489',
 '[{"step": 1, "prompt": "language selection", "action": "1", "note": "English"},
   {"step": 2, "prompt": "department selection", "action": "2", "note": "Technical Support"},
   {"step": 3, "prompt": "account verification", "action": "account_number", "note": "Enter account number"},
   {"step": 4, "prompt": "issue type", "action": "1", "note": "Internet issues"}]'::jsonb,
 '["account_holder_name", "account_number", "service_address", "issue_description"]'::jsonb,
 '24/7',
 'Xfinity/Comcast technical support line'),

('Xfinity', 'billing', '+18009346489',
 '[{"step": 1, "prompt": "language selection", "action": "1", "note": "English"},
   {"step": 2, "prompt": "department selection", "action": "1", "note": "Billing"},
   {"step": 3, "prompt": "account verification", "action": "account_number", "note": "Enter account number"}]'::jsonb,
 '["account_holder_name", "account_number"]'::jsonb,
 '24/7',
 'Xfinity/Comcast billing inquiries'),

('AT&T', 'tech_support', '+18002882020',
 '[{"step": 1, "prompt": "language selection", "action": "1", "note": "English"},
   {"step": 2, "prompt": "service type", "action": "1", "note": "Internet/Home services"},
   {"step": 3, "prompt": "issue type", "action": "2", "note": "Technical support"}]'::jsonb,
 '["account_holder_name", "phone_number_on_account", "service_address", "issue_description"]'::jsonb,
 '8am-10pm local time',
 'AT&T technical support'),

('PG&E', 'general', '+18007435000',
 '[{"step": 1, "prompt": "language selection", "action": "1", "note": "English"},
   {"step": 2, "prompt": "account holder", "action": "1", "note": "Yes, I am the account holder"},
   {"step": 3, "prompt": "reason for call", "action": "0", "note": "Speak to representative"}]'::jsonb,
 '["account_holder_name", "service_address", "account_number"]'::jsonb,
 'Mon-Fri 7am-7pm, Sat 8am-5pm PT',
 'PG&E customer service'),

('CVS Pharmacy', 'prescription', '+18007467287',
 '[{"step": 1, "prompt": "store or mail", "action": "1", "note": "Store pharmacy"},
   {"step": 2, "prompt": "prescription number", "action": "prescription_number", "note": "Enter Rx number"}]'::jsonb,
 '["patient_name", "date_of_birth", "prescription_number"]'::jsonb,
 'Varies by location',
 'CVS prescription refills and inquiries');

-- Function to update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Triggers for updated_at
create trigger update_user_memories_updated_at before update on public.user_memories
  for each row execute function update_updated_at_column();

create trigger update_user_contacts_updated_at before update on public.user_contacts
  for each row execute function update_updated_at_column();

create trigger update_ivr_paths_updated_at before update on public.ivr_paths
  for each row execute function update_updated_at_column();

create trigger update_call_contexts_updated_at before update on public.call_contexts
  for each row execute function update_updated_at_column();
