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
  _int_total int;
  _int_mod int;
  _shield_cap int;
  _new_stance_state jsonb;
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

  if _existing ? p_stance_key then
    return _existing;
  end if;

  if (p_stance_key = 'ignite' and _existing ? 'envenom')
     or (p_stance_key = 'envenom' and _existing ? 'ignite') then
    raise exception 'Ignite and Envenom are mutually exclusive';
  end if;

  select coalesce(sum((value->>'reserved')::int), 0) into _reserved_total
  from jsonb_each(_existing);

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

  -- Force Shield: seed the persistent ward HP at full cap on first activation.
  if p_stance_key = 'force_shield' then
    _int_total := coalesce(_char.int, 10);
    _int_mod := greatest(0, ((_int_total - 10) / 2));
    _shield_cap := greatest(1, _int_mod + (coalesce(_char.level, 1) / 2));
    _new_stance_state := coalesce(_char.stance_state, '{}'::jsonb)
      || jsonb_build_object(
           'force_shield_hp', _shield_cap,
           'force_shield_updated_at', to_jsonb(now())
         );
    update public.characters
       set reserved_buffs = _existing || jsonb_build_object(p_stance_key, _entry),
           stance_state = _new_stance_state
     where id = p_character_id
     returning reserved_buffs into _existing;
  else
    update public.characters
       set reserved_buffs = _existing || jsonb_build_object(p_stance_key, _entry)
     where id = p_character_id
     returning reserved_buffs into _existing;
  end if;

  return _existing;
end;
$$;

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
     set reserved_buffs = coalesce(reserved_buffs, '{}'::jsonb) - p_stance_key,
         stance_state = case
           when p_stance_key = 'force_shield'
             then coalesce(stance_state, '{}'::jsonb) - 'force_shield_hp' - 'force_shield_updated_at'
           else stance_state
         end
   where id = p_character_id
   returning reserved_buffs into _existing;

  return coalesce(_existing, '{}'::jsonb);
end;
$$;

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
     set reserved_buffs = '{}'::jsonb,
         stance_state = coalesce(stance_state, '{}'::jsonb) - 'force_shield_hp' - 'force_shield_updated_at'
   where id = p_character_id
   returning '{}'::jsonb into _had;

  return coalesce(_had, '{}'::jsonb);
end;
$$;