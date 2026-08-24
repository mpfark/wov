-- PREPARED, NOT APPLIED. Backfills Judgment's canonical combat_text slots
-- (`hit` / `miss`) alongside the existing verb aliases. Idempotent.
UPDATE public.abilities
SET combat_text = COALESCE(combat_text, '{}'::jsonb) || jsonb_build_object(
      'hit',  '{attacker} passes divine judgment upon {target}!',
      'miss', '{attacker}''s {ability} pronounces sentence, but {target} is spared.'
    ),
    updated_at = now()
WHERE ability_key = 'judgment'
  AND (
    COALESCE(combat_text->>'hit', '')  <> '{attacker} passes divine judgment upon {target}!'
    OR COALESCE(combat_text->>'miss', '') <> '{attacker}''s {ability} pronounces sentence, but {target} is spared.'
  );
