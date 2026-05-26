
-- Storage bucket for node scene illustrations
insert into storage.buckets (id, name, public)
values ('node-illustrations', 'node-illustrations', true)
on conflict (id) do nothing;

-- Public read access for node-illustrations
create policy "Public can view node illustrations"
on storage.objects for select
using (bucket_id = 'node-illustrations');

create policy "Service role can manage node illustrations"
on storage.objects for all
using (bucket_id = 'node-illustrations' and auth.role() = 'service_role')
with check (bucket_id = 'node-illustrations' and auth.role() = 'service_role');

-- Run-level log
create table public.ai_credit_drain_log (
  id uuid primary key default gen_random_uuid(),
  run_started_at timestamptz not null default now(),
  run_finished_at timestamptz,
  generated_count integer not null default 0,
  cap integer not null default 10,
  stop_reason text not null default 'unknown',
  notes text
);

alter table public.ai_credit_drain_log enable row level security;

create policy "Overlords can view drain log"
on public.ai_credit_drain_log for select
using (is_overlord());

create policy "Service role full access drain log"
on public.ai_credit_drain_log for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- Per-node attempt log
create table public.ai_credit_drain_item_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_credit_drain_log(id) on delete cascade,
  node_id uuid not null,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create index ai_credit_drain_item_log_run_idx on public.ai_credit_drain_item_log(run_id);

alter table public.ai_credit_drain_item_log enable row level security;

create policy "Overlords can view drain item log"
on public.ai_credit_drain_item_log for select
using (is_overlord());

create policy "Service role full access drain item log"
on public.ai_credit_drain_item_log for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
