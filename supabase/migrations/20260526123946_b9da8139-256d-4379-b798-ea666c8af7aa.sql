
create table public.app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;

create policy "Overlords can manage app_secrets"
on public.app_secrets for all
using (is_overlord())
with check (is_overlord());

create policy "Service role full access app_secrets"
on public.app_secrets for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create or replace function public.get_app_secret(_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select value from public.app_secrets where key = _key
$$;

-- Restrict execute: only postgres/service_role (used by cron) can read raw secrets
revoke execute on function public.get_app_secret(text) from public, anon, authenticated;
