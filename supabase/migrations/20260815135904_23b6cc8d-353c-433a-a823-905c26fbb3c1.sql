-- TEMPORARY: one-shot validation authorization. Removed together with the harness.
create table if not exists public.combat_validation_grants (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  node_id uuid not null references public.nodes(id) on delete cascade,
  role text not null check (role = 'catchup'),
  expires_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists combat_validation_grants_token_node
  on public.combat_validation_grants (token_hash, node_id);

grant all on public.combat_validation_grants to service_role;
alter table public.combat_validation_grants enable row level security;
-- No anon/authenticated grants and no policies: service role only.

create or replace function public.combat_validation_grant_check(
  _token text, _node_id uuid, _role text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.combat_validation_grants g
    where g.node_id = _node_id
      and g.role = _role
      and _role = 'catchup'
      and g.expires_at > now()
      and g.token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex')
  )
$$;
revoke all on function public.combat_validation_grant_check(text, uuid, text) from public;
grant execute on function public.combat_validation_grant_check(text, uuid, text) to service_role;

-- PERMANENT: authored-status configuration guard, mirroring
-- src/shared/config/status-contract.ts.
create or replace function public.status_config_problems()
returns table (code text, status_key text, ability_key text, detail text)
language sql
stable
security definer
set search_path = public
as $$
  with required(key, effect_type, classification, damage_type) as (
    values
      ('poison','poison','dot','poison'),
      ('ignite','ignite','dot','fire'),
      ('bleed','bleed','dot','physical'),
      ('scorched','scorched','dot','fire'),
      ('chilled','chilled','damage_amp',null)
  ), checked as (
    select r.key, s.key as found,
      concat_ws('; ',
        case when s.effect_type is distinct from r.effect_type
             then format('effect_type must be "%s", got "%s"', r.effect_type, coalesce(s.effect_type,'null')) end,
        case when s.classification is distinct from r.classification
             then format('classification must be "%s", got "%s"', r.classification, coalesce(s.classification,'null')) end,
        case when r.damage_type is not null and s.default_damage_type is distinct from r.damage_type
             then format('default_damage_type must be "%s", got "%s"', r.damage_type, coalesce(s.default_damage_type,'null')) end,
        case when coalesce((s.duration->>'base_ms')::numeric, 0) <= 0
              and coalesce((s.duration->>'duration_ticks')::numeric, 0) < 1
             then 'duration: neither duration.base_ms > 0 nor duration.duration_ticks >= 1' end,
        case when r.classification = 'dot' and coalesce(s.tick_interval_ms, 0) <= 0
             then 'tick_interval_ms must be > 0 for a periodic status' end,
        case when r.classification = 'dot' and s.is_periodic is not true
             then 'is_periodic must be true for a damage-over-time status' end,
        case when r.classification = 'dot'
              and coalesce((s.magnitude->>'flat')::numeric, 0) <= 0
              and coalesce((s.magnitude->>'stat_mult')::numeric, 0) <= 0
             then 'magnitude: needs flat > 0 or stat_mult > 0' end,
        case when r.classification = 'dot'
              and coalesce((s.magnitude->>'stat_mult')::numeric, 0) > 0
              and coalesce(s.magnitude->>'role','') not in ('primary','secondary')
             then 'magnitude scales with an attribute but magnitude.role is unset' end,
        case when r.classification = 'damage_amp'
              and coalesce((s.modifier->>'value')::numeric, 0) <= 0
             then 'modifier.value must be > 0 for a damage amplifier' end,
        case when r.classification = 'damage_amp'
              and coalesce(s.modifier->>'kind','') = ''
             then 'modifier.kind is required for a damage amplifier' end,
        case when coalesce((s.stacks->'max_stacks_calc'->>'base')::numeric, 0) < 1
             then 'stacks.max_stacks_calc.base must be >= 1' end
      ) as problem
    from required r
    left join public.applied_statuses s on s.key = r.key
  )
  select 'missing_status_definition', c.key, null::text,
         format('required status "%s" is not authored in applied_statuses', c.key)
  from checked c where c.found is null
  union all
  select 'invalid_status_definition', c.key, null::text, c.problem
  from checked c where c.found is not null and coalesce(c.problem, '') <> ''
  union all
  select 'missing_status_definition', a.applied_status, a.ability_key,
         format('ability "%s" references unauthored status "%s"', a.ability_key, a.applied_status)
  from public.abilities a
  where a.applied_status is not null
    and not exists (select 1 from public.applied_statuses s where s.key = a.applied_status)
$$;

grant execute on function public.status_config_problems() to authenticated, service_role;