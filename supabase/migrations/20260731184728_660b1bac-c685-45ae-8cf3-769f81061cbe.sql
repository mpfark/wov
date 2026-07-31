-- Phase 5c follow-up: align the SQL heal/damage RPCs with the shared
-- resolveHeal / resolveDamage clamp rules (src/shared/combat/resolution.ts):
--   * amounts are clamped to >= 0 (never a stealth heal / stealth drain)
--   * healing NEVER revives a fallen character (hp <= 0 -> no-op, returns 0)
--   * the returned value is the REAL delta, so logs cannot over-report
--   * hp stays within [0, cap]

CREATE OR REPLACE FUNCTION public.heal_party_member(_healer_id uuid, _target_id uuid, _heal_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _target RECORD;
  _amount integer;
  _restored integer;
BEGIN
  IF NOT owns_character(_healer_id) THEN
    RAISE EXCEPTION 'Not authorized: you do not own this character';
  END IF;

  IF _healer_id <> _target_id AND NOT EXISTS (
    SELECT 1
    FROM party_members pm1
    JOIN party_members pm2 ON pm1.party_id = pm2.party_id
    WHERE pm1.character_id = _healer_id
      AND pm2.character_id = _target_id
      AND pm1.status = 'accepted'
      AND pm2.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Target is not in your party';
  END IF;

  _amount := GREATEST(COALESCE(_heal_amount, 0), 0);

  SELECT hp, max_hp INTO _target FROM characters WHERE id = _target_id FOR UPDATE;
  IF NOT FOUND OR _target.hp <= 0 THEN
    RETURN 0;  -- healing does not revive the fallen
  END IF;

  _restored := GREATEST(LEAST(_target.hp + _amount, _target.max_hp) - _target.hp, 0);
  IF _restored > 0 THEN
    UPDATE characters SET hp = _target.hp + _restored WHERE id = _target_id;
  END IF;

  RETURN _restored;
END;
$function$;

CREATE OR REPLACE FUNCTION public.heal_party_member(_healer_id uuid, _target_id uuid, _heal_amount integer, _effective_max_hp integer DEFAULT NULL::integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _target RECORD;
  _amount integer;
  _cap integer;
  _restored integer;
BEGIN
  IF NOT owns_character(_healer_id) THEN
    RAISE EXCEPTION 'Not authorized: you do not own this character';
  END IF;

  IF _healer_id <> _target_id AND NOT EXISTS (
    SELECT 1
    FROM party_members pm1
    JOIN party_members pm2 ON pm1.party_id = pm2.party_id
    WHERE pm1.character_id = _healer_id
      AND pm2.character_id = _target_id
      AND pm1.status = 'accepted'
      AND pm2.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Target is not in your party';
  END IF;

  _amount := GREATEST(COALESCE(_heal_amount, 0), 0);

  SELECT hp, max_hp INTO _target FROM characters WHERE id = _target_id FOR UPDATE;
  IF NOT FOUND OR _target.hp <= 0 THEN
    RETURN 0;  -- healing does not revive the fallen
  END IF;

  -- Gear/gem bonuses can raise the effective cap above characters.max_hp.
  _cap := GREATEST(COALESCE(_effective_max_hp, _target.max_hp), 1);

  _restored := GREATEST(LEAST(_target.hp + _amount, _cap) - _target.hp, 0);
  IF _restored > 0 THEN
    UPDATE characters SET hp = _target.hp + _restored WHERE id = _target_id;
  END IF;

  RETURN _restored;
END;
$function$;

CREATE OR REPLACE FUNCTION public.damage_party_member(_character_id uuid, _damage integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _amount integer;
  _new_hp integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM party_members pm1
    JOIN party_members pm2 ON pm1.party_id = pm2.party_id
    WHERE pm1.character_id = _character_id
      AND pm1.status = 'accepted'
      AND pm2.status = 'accepted'
      AND pm2.character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not in the same party';
  END IF;

  -- Negative damage must never act as a heal.
  _amount := GREATEST(COALESCE(_damage, 0), 0);

  UPDATE characters
  SET hp = GREATEST(hp - _amount, 0)
  WHERE id = _character_id
    AND hp > 0                          -- the fallen take no further damage
  RETURNING hp INTO _new_hp;

  IF _new_hp IS NULL THEN
    SELECT hp INTO _new_hp FROM characters WHERE id = _character_id;
  END IF;

  RETURN COALESCE(_new_hp, 0);
END;
$function$;