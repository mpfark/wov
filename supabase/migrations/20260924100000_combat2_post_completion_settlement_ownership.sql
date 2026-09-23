-- Scope a live Combat2 claim to a fighter who is still present. Historical
-- fighter rows remain intact, but cannot retain resource-settlement ownership.
BEGIN;

DO $migration$
DECLARE
  definition text;
  old_predicate text := 'OR (e.claim_token IS NOT NULL AND e.claim_expires_at > _now)';
  new_predicate text := 'OR (f.present AND e.claim_token IS NOT NULL AND e.claim_expires_at > _now)';
BEGIN
  SELECT pg_get_functiondef(
    'public.settle_out_of_combat_resources(timestamptz)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
     OR position(old_predicate IN definition) = 0
     OR position(new_predicate IN definition) > 0 THEN
    RAISE EXCEPTION 'unexpected out-of-combat ownership predicate';
  END IF;

  definition := replace(definition, old_predicate, new_predicate);
  IF position(old_predicate IN definition) > 0
     OR position(new_predicate IN definition) = 0 THEN
    RAISE EXCEPTION 'out-of-combat ownership predicate replacement failed';
  END IF;

  EXECUTE definition;
END
$migration$;

DO $verify$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.settle_out_of_combat_resources(timestamptz)'::regprocedure
  ) INTO definition;

  IF position(
    'OR (f.present AND e.claim_token IS NOT NULL AND e.claim_expires_at > _now)'
    IN definition
  ) = 0 THEN
    RAISE EXCEPTION 'post-completion settlement ownership verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.node_encounter'::regclass
      AND trigger_row.tgname = 'combat2_close_inactive_encounter_fighters'
      AND trigger_row.tgenabled <> 'D'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'inactive fighter release trigger is missing or disabled';
  END IF;
END
$verify$;

COMMIT;
