-- ── 1. lifetime marker on persisted combat effects ───────────────────
ALTER TABLE public.active_effects
  ADD COLUMN IF NOT EXISTS lifetime text NOT NULL DEFAULT 'timed';

ALTER TABLE public.active_effects
  DROP CONSTRAINT IF EXISTS active_effects_lifetime_check;
ALTER TABLE public.active_effects
  ADD CONSTRAINT active_effects_lifetime_check
  CHECK (lifetime IN ('timed', 'stance'));

-- One stance effect of a kind per character. Target stacks (Ignite/Envenom on a
-- creature) are separate timed rows and are unaffected by this index.
CREATE UNIQUE INDEX IF NOT EXISTS active_effects_stance_identity
  ON public.active_effects (target_id, effect_type)
  WHERE lifetime = 'stance';

-- ── 2. stance rows fail closed ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_stance_effect_lifetime()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  _stance_keys text[] := array[
    'ignite','envenom','holy_shield','force_shield',
    'eagle_eye','arcane_surge','battle_cry','shield_wall'];
BEGIN
  IF NEW.lifetime <> 'stance' THEN
    RETURN NEW;
  END IF;

  IF NOT (NEW.effect_type = ANY(_stance_keys)) THEN
    RAISE EXCEPTION 'active_effects.lifetime: "%" is not a stance', NEW.effect_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- No-expiry sentinel: Number.MAX_SAFE_INTEGER. A stance ends only when its
  -- reservation ends, never on a clock.
  IF NEW.expires_at <> 9007199254740991 THEN
    RAISE EXCEPTION 'active_effects.expiresAtMs: stance "%" must carry the no-expiry sentinel', NEW.effect_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.source_id IS DISTINCT FROM NEW.target_id THEN
    RAISE EXCEPTION 'active_effects.sourceCharacterId: stance "%" is self-applied', NEW.effect_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.id = NEW.target_id
      AND COALESCE(c.reserved_buffs, '{}'::jsonb) ? NEW.effect_type
  ) THEN
    RAISE EXCEPTION 'active_effects.lifetime: stance "%" has no CP reservation on character %',
      NEW.effect_type, NEW.target_id USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_active_effects_stance_lifetime ON public.active_effects;
CREATE TRIGGER trg_active_effects_stance_lifetime
  BEFORE INSERT OR UPDATE ON public.active_effects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_stance_effect_lifetime();

-- ── 3. one authority for stance end ──────────────────────────────────
-- characters.reserved_buffs is the activation record. Drop, replace, logout
-- clear and the on-death wipe all mutate it, so removing the stance effect here
-- covers every end path exactly once.
CREATE OR REPLACE FUNCTION public.sync_stance_effects()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  DELETE FROM public.active_effects ae
   WHERE ae.target_id = NEW.id
     AND ae.lifetime = 'stance'
     AND NOT (COALESCE(NEW.reserved_buffs, '{}'::jsonb) ? ae.effect_type);
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS trg_characters_sync_stance_effects ON public.characters;
CREATE TRIGGER trg_characters_sync_stance_effects
  AFTER UPDATE OF reserved_buffs ON public.characters
  FOR EACH ROW
  WHEN (NEW.reserved_buffs IS DISTINCT FROM OLD.reserved_buffs)
  EXECUTE FUNCTION public.sync_stance_effects();

-- Reconcile any stance row that predates the trigger.
DELETE FROM public.active_effects ae
USING public.characters c
WHERE ae.lifetime = 'stance'
  AND c.id = ae.target_id
  AND NOT (COALESCE(c.reserved_buffs, '{}'::jsonb) ? ae.effect_type);

-- ── 4. carry lifetime through snapshot and commit ────────────────────
DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'encounter_snapshot_v2';

  v_new := replace(
    v_def,
    $old$        'paramsVersion', ae.params_version,$old$,
    $new$        'paramsVersion', ae.params_version, 'lifetime', ae.lifetime,$new$);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'encounter_snapshot_v2: effect lifetime anchor not found';
  END IF;
  EXECUTE v_new;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'commit_encounter_tick_v2';

  v_new := replace(
    v_def,
    $old$     mechanic, magnitude, remaining, params, params_version)$old$,
    $new$     mechanic, magnitude, remaining, params, params_version, lifetime)$new$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'commit_encounter_tick_v2: effect column-list anchor not found';
  END IF;
  v_def := v_new;

  v_new := replace(
    v_def,
    $old$         COALESCE(e->'params', '{}'::jsonb), COALESCE((e->>'paramsVersion')::integer, 1)$old$,
    $new$         COALESCE(e->'params', '{}'::jsonb), COALESCE((e->>'paramsVersion')::integer, 1),
         COALESCE(e->>'lifetime', 'timed')$new$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'commit_encounter_tick_v2: effect select-list anchor not found';
  END IF;
  v_def := v_new;

  v_new := replace(
    v_def,
    $old$        -- Mutable each tick: the pool/charge state.
        remaining = EXCLUDED.remaining;$old$,
    $new$        -- Lifetime is an identity, never weakened by a re-application.
        lifetime = COALESCE(EXCLUDED.lifetime, ae.lifetime),
        -- Mutable each tick: the pool/charge state.
        remaining = EXCLUDED.remaining;$new$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'commit_encounter_tick_v2: effect conflict-update anchor not found';
  END IF;
  EXECUTE v_new;
END
$mig$;