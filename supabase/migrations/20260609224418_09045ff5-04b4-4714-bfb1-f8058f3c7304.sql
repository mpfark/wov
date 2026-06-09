
-- ── Phase 2 schema ───────────────────────────────────────────────
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS soulring_tier integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soulring_inventory_id uuid NULL;

-- ── Phase 3 schema ───────────────────────────────────────────────
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS king_slayer_at timestamptz NULL;

-- ── Wipe legacy soulforged items (Crown + Soulforge era) ─────────
DELETE FROM public.character_inventory ci
 USING public.items i
 WHERE ci.item_id = i.id
   AND i.rarity = 'soulforged';

DELETE FROM public.items WHERE rarity = 'soulforged';

UPDATE public.characters
   SET crown_item_created = false,
       soulforged_item_created = false;

-- ── Tighten the character-edit guard ────────────────────────────
CREATE OR REPLACE FUNCTION public.restrict_party_leader_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _stat_delta integer;
  _points_delta integer;
  _respec_delta integer;
  _trusted boolean;
BEGIN
  _trusted := coalesce(current_setting('app.trusted_rpc', true), '') = 'true';

  IF auth.uid() = NEW.user_id THEN
    NEW.level := OLD.level;
    NEW.xp := OLD.xp;
    NEW.user_id := OLD.user_id;

    -- Race / class / classless flag — trusted-only
    IF NOT _trusted THEN
      NEW.race := OLD.race;
      NEW.class := OLD.class;
      NEW.is_classless := OLD.is_classless;
    END IF;

    -- Legacy crown/soulforge flags can only flip false → true (kept for back-compat)
    IF OLD.soulforged_item_created = true THEN
      NEW.soulforged_item_created := true;
    END IF;

    -- Soulring + king title — fully trusted-only
    IF NOT _trusted THEN
      NEW.soulring_tier := OLD.soulring_tier;
      NEW.soulring_inventory_id := OLD.soulring_inventory_id;
      NEW.king_slayer_at := OLD.king_slayer_at;
    END IF;

    IF NEW.gold > OLD.gold AND NOT _trusted THEN
      NEW.gold := OLD.gold;
    END IF;

    IF NOT _trusted THEN
      NEW.max_hp := OLD.max_hp;
      NEW.max_cp := OLD.max_cp;
      NEW.max_mp := OLD.max_mp;
      NEW.ac := OLD.ac;
    END IF;

    IF NEW.bhp > OLD.bhp THEN
      NEW.bhp := OLD.bhp;
    END IF;

    IF NEW.rp_total_earned > OLD.rp_total_earned THEN
      NEW.rp_total_earned := OLD.rp_total_earned;
    END IF;

    IF NEW.respec_points > OLD.respec_points THEN
      NEW.respec_points := OLD.respec_points;
    END IF;

    _stat_delta := (NEW.str - OLD.str) + (NEW.dex - OLD.dex) + (NEW.con - OLD.con)
                 + (NEW.int - OLD.int) + (NEW.wis - OLD.wis) + (NEW.cha - OLD.cha);
    _points_delta := OLD.unspent_stat_points - NEW.unspent_stat_points;
    _respec_delta := OLD.respec_points - NEW.respec_points;

    IF _respec_delta <= 0 THEN
      IF _stat_delta > 0 AND _stat_delta != _points_delta THEN
        NEW.str := OLD.str;
        NEW.dex := OLD.dex;
        NEW.con := OLD.con;
        NEW.int := OLD.int;
        NEW.wis := OLD.wis;
        NEW.cha := OLD.cha;
        NEW.unspent_stat_points := OLD.unspent_stat_points;
      END IF;
      IF NEW.unspent_stat_points > OLD.unspent_stat_points THEN
        NEW.unspent_stat_points := OLD.unspent_stat_points;
      END IF;
    END IF;

    NEW.gold := GREATEST(NEW.gold, 0);
    NEW.ac := LEAST(GREATEST(NEW.ac, 1), 100);
    NEW.max_hp := LEAST(GREATEST(NEW.max_hp, 1), 10000);
    NEW.max_cp := LEAST(GREATEST(NEW.max_cp, 0), 5000);
  END IF;

  RETURN NEW;
END;
$function$;

-- ── forge_soulring RPC ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.forge_soulring(
  p_character_id uuid,
  p_stats jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _char            RECORD;
  _next_tier       integer;
  _milestone_level integer;
  _milestones      integer[] := ARRAY[30, 33, 36, 39, 42];
  _names           text[]    := ARRAY[
    'Soulforged Ring',
    'Tempered Soulforged Ring',
    'Refined Soulforged Ring',
    'Masterwork Soulforged Ring',
    'Ascended Soulforged Ring'
  ];
  _ring_name       text;
  _allowed_keys    text[] := ARRAY['str','dex','con','int','wis','cha','ac','hp','hp_regen'];
  _stat_costs      jsonb := jsonb_build_object(
    'str',1,'dex',1,'con',1,'int',1,'wis',1,'cha',1,
    'ac',3,'hp',0.5,'hp_regen',2
  );
  _budget          integer;
  _taper           numeric;
  _cost_total      numeric := 0;
  _stat_count      integer := 0;
  _key             text;
  _val             integer;
  _cap             integer;
  _per_cost        numeric;
  _new_item_id     uuid;
  _new_inv_id      uuid;
  _value           integer;
  _clean_stats     jsonb := '{}'::jsonb;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_stats IS NULL OR jsonb_typeof(p_stats) <> 'object' THEN
    RAISE EXCEPTION 'Invalid stats payload';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('soulring_' || p_character_id::text));

  SELECT id, level, soulring_tier, soulring_inventory_id, name
    INTO _char
    FROM public.characters
   WHERE id = p_character_id
   FOR UPDATE;

  IF _char IS NULL THEN
    RAISE EXCEPTION 'Character not found';
  END IF;

  _next_tier := _char.soulring_tier + 1;
  IF _next_tier < 1 OR _next_tier > 5 THEN
    RAISE EXCEPTION 'Your Soulforged Ring is already fully Ascended';
  END IF;

  _milestone_level := _milestones[_next_tier];
  IF _char.level < _milestone_level THEN
    RAISE EXCEPTION 'You must be level % to forge this tier (current %)',
      _milestone_level, _char.level;
  END IF;

  -- Stat budget: mirror getItemStatBudget(level, 'soulforged', 1)
  -- raw = 2 + (level - 1) * 0.24 * 2.0 * 1.0
  -- taper: ≤30 = 1.0; ≤35 = 0.90; ≤40 = 0.80; else 0.72
  IF _milestone_level <= 30 THEN _taper := 1.0;
  ELSIF _milestone_level <= 35 THEN _taper := 0.90;
  ELSIF _milestone_level <= 40 THEN _taper := 0.80;
  ELSE _taper := 0.72;
  END IF;
  _budget := GREATEST(2, floor((2 + (_milestone_level - 1) * 0.24 * 2.0) * _taper)::integer);

  -- Validate / sanitize stats
  FOR _key, _val IN
    SELECT k, (v)::text::integer
      FROM jsonb_each_text(p_stats) AS t(k, v)
  LOOP
    IF NOT (_key = ANY(_allowed_keys)) THEN CONTINUE; END IF;
    IF _val IS NULL OR _val <= 0 THEN CONTINUE; END IF;

    -- Per-stat caps
    IF _key IN ('ac','hp_regen') THEN
      _cap := 2 + floor(_milestone_level / 10)::integer;
    ELSIF _key = 'hp' THEN
      _cap := 6 + floor(_milestone_level / 5)::integer * 2;
    ELSE
      -- Primary attribute cap
      IF _milestone_level <= 28 THEN
        _cap := 4 + floor(_milestone_level / 4)::integer;
      ELSIF _milestone_level <= 40 THEN
        _cap := 11 + floor((_milestone_level - 28) / 6)::integer;
      ELSE
        _cap := 13;
      END IF;
    END IF;

    IF _val > _cap THEN
      RAISE EXCEPTION '% exceeds cap of % at level %', _key, _cap, _milestone_level;
    END IF;

    _per_cost := (_stat_costs ->> _key)::numeric;
    _cost_total := _cost_total + _val * _per_cost;
    _stat_count := _stat_count + 1;
    _clean_stats := _clean_stats || jsonb_build_object(_key, _val);
  END LOOP;

  IF _stat_count < 2 THEN
    RAISE EXCEPTION 'Ring must have at least 2 different stats';
  END IF;
  IF _cost_total > _budget THEN
    RAISE EXCEPTION 'Stats exceed budget (%/%)', _cost_total, _budget;
  END IF;

  -- Delete previous ring (inventory row + item row) if present
  IF _char.soulring_inventory_id IS NOT NULL THEN
    DELETE FROM public.character_inventory
     WHERE id = _char.soulring_inventory_id
       AND character_id = p_character_id
     RETURNING item_id INTO _new_item_id;  -- reuse var temporarily
    IF _new_item_id IS NOT NULL THEN
      DELETE FROM public.items WHERE id = _new_item_id;
    END IF;
    _new_item_id := NULL;
  END IF;

  _ring_name := _names[_next_tier];
  _value := floor(_milestone_level * 2.5 * (2.0 * 2.0))::integer;

  -- Insert new ring template
  INSERT INTO public.items (
    name, description, item_type, slot, rarity, level, hands,
    stats, value, max_durability, is_soulbound
  ) VALUES (
    _ring_name,
    'A Soulforged Ring bound to ' || _char.name || '.',
    'equipment', 'ring'::item_slot, 'soulforged'::item_rarity, _milestone_level, NULL,
    _clean_stats, _value, 100, true
  )
  RETURNING id INTO _new_item_id;

  INSERT INTO public.character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, _new_item_id, 100)
  RETURNING id INTO _new_inv_id;

  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE public.characters
     SET soulring_tier = _next_tier,
         soulring_inventory_id = _new_inv_id
   WHERE id = p_character_id;

  RETURN jsonb_build_object(
    'tier', _next_tier,
    'name', _ring_name,
    'level', _milestone_level,
    'item_id', _new_item_id,
    'inventory_id', _new_inv_id,
    'stats', _clean_stats,
    'budget', _budget
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.forge_soulring(uuid, jsonb) TO authenticated;

-- ── crown_king_slayer RPC (service-role only) ────────────────────
CREATE OR REPLACE FUNCTION public.crown_king_slayer(_character_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE public.characters SET king_slayer_at = NULL WHERE king_slayer_at IS NOT NULL;
  UPDATE public.characters SET king_slayer_at = now() WHERE id = _character_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crown_king_slayer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crown_king_slayer(uuid) TO service_role;

-- ── expire_king_slayer (janitor; mirror 30-min offline rule) ─────
CREATE OR REPLACE FUNCTION public.expire_king_slayer()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE public.characters
     SET king_slayer_at = NULL
   WHERE king_slayer_at IS NOT NULL
     AND last_online < now() - interval '30 minutes';
END;
$$;
REVOKE ALL ON FUNCTION public.expire_king_slayer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_king_slayer() TO service_role;
