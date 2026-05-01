-- 1. Column
alter table public.characters
  add column if not exists reserved_buffs jsonb not null default '{}'::jsonb;

-- 2. Allow trusted RPCs to write reserved_buffs by extending the existing trigger gate.
-- The existing restrict_party_leader_updates trigger lets owners update most fields,
-- but reserved_buffs isn't named anywhere — owners can already update jsonb columns.
-- We don't need to change the trigger because reserved_buffs isn't in its blocklist.

-- 3. Activate stance RPC
create or replace function public.activate_stance(
  p_character_id uuid,
  p_stance_key text,
  p_tier int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _char record;
  _existing jsonb;
  _reserved_total int := 0;
  _entry jsonb;
  _pct numeric;
  _reserve int;
  _available int;
  _allowed text[] := array['ignite','envenom','holy_shield','force_shield','eagle_eye','arcane_surge','battle_cry'];
begin
  if not owns_character(p_character_id) then
    raise exception 'Not authorized';
  end if;
  if not (p_stance_key = any(_allowed)) then
    raise exception 'Unknown stance: %', p_stance_key;
  end if;
  if p_tier not in (1,2,3) then
    raise exception 'Invalid tier: %', p_tier;
  end if;

  select * into _char from public.characters where id = p_character_id for update;
  if _char is null then
    raise exception 'Character not found';
  end if;

  _existing := coalesce(_char.reserved_buffs, '{}'::jsonb);

  -- Already active? No-op success.
  if _existing ? p_stance_key then
    return _existing;
  end if;

  -- Mutual exclusion: ignite vs envenom
  if (p_stance_key = 'ignite' and _existing ? 'envenom')
     or (p_stance_key = 'envenom' and _existing ? 'ignite') then
    raise exception 'Ignite and Envenom are mutually exclusive';
  end if;

  -- Sum existing reservations
  select coalesce(sum((value->>'reserved')::int), 0) into _reserved_total
  from jsonb_each(_existing);

  -- Tier % of max CP, rounded up, min 5
  _pct := case p_tier when 1 then 0.10 when 2 then 0.15 when 3 then 0.20 end;
  _reserve := greatest(5, ceil(_char.max_cp * _pct)::int);

  _available := _char.cp - _reserved_total;
  if _reserve > _available then
    raise exception 'Not enough available CP (need %, have %)', _reserve, _available;
  end if;

  _entry := jsonb_build_object(
    'tier', p_tier,
    'reserved', _reserve,
    'activated_at', (extract(epoch from now()) * 1000)::bigint
  );

  update public.characters
     set reserved_buffs = _existing || jsonb_build_object(p_stance_key, _entry)
   where id = p_character_id
   returning reserved_buffs into _existing;

  return _existing;
end;
$$;

-- 4. Drop stance RPC (no CP refund)
create or replace function public.drop_stance(
  p_character_id uuid,
  p_stance_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _existing jsonb;
begin
  if not owns_character(p_character_id) then
    raise exception 'Not authorized';
  end if;

  update public.characters
     set reserved_buffs = coalesce(reserved_buffs, '{}'::jsonb) - p_stance_key
   where id = p_character_id
   returning reserved_buffs into _existing;

  return coalesce(_existing, '{}'::jsonb);
end;
$$;

-- 5. Wipe stances on character load (also usable for respec/class change/death cleanup)
create or replace function public.clear_stances(
  p_character_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _had jsonb;
begin
  if not (owns_character(p_character_id) or is_steward_or_overlord()) then
    raise exception 'Not authorized';
  end if;

  update public.characters
     set reserved_buffs = '{}'::jsonb
   where id = p_character_id
   returning '{}'::jsonb into _had;

  return coalesce(_had, '{}'::jsonb);
end;
$$;