-- Explicit accuracy attribute for roll-based abilities.
ALTER TABLE public.abilities
  ADD COLUMN IF NOT EXISTS accuracy_stat text;

ALTER TABLE public.abilities
  DROP CONSTRAINT IF EXISTS abilities_accuracy_stat_valid;
ALTER TABLE public.abilities
  ADD CONSTRAINT abilities_accuracy_stat_valid
  CHECK (accuracy_stat IS NULL OR accuracy_stat IN ('str','dex','con','int','wis','cha'));

-- Backfill the 11 roll-based class abilities with their approved attribute.
UPDATE public.abilities SET accuracy_stat = v.stat
FROM (VALUES
  ('power_strike','dex'), ('aimed_shot','dex'), ('backstab','dex'),
  ('barrage','dex'), ('eviscerate','dex'),
  ('fireball','int'), ('frostbolt','int'), ('frost_bolt','int'), ('conflagrate','int'),
  ('judgment','wis'), ('smite','wis'),
  ('cutting_words','cha'), ('grand_finale','cha')
) AS v(key, stat)
WHERE public.abilities.ability_key = v.key
  AND (public.abilities.accuracy_stat IS DISTINCT FROM v.stat);

-- Frost Bolt scales from INT.
UPDATE public.abilities
   SET primary_attribute = 'int'
 WHERE ability_key IN ('frostbolt','frost_bolt')
   AND primary_attribute IS DISTINCT FROM 'int';

-- Automatic (non-rolling) mechanics never carry an accuracy attribute.
UPDATE public.abilities
   SET accuracy_stat = NULL
 WHERE accuracy_stat IS NOT NULL
   AND mechanic_key NOT IN ('weapon_attack','spell_attack','multi_attack','burst_damage','stack_consume');

-- Carry the attribute into effect_config, which is what the combat loader reads.
UPDATE public.abilities
   SET effect_config = COALESCE(effect_config, '{}'::jsonb)
                       || jsonb_build_object('accuracy_stat', accuracy_stat)
 WHERE accuracy_stat IS NOT NULL
   AND COALESCE(effect_config->>'accuracy_stat', '') IS DISTINCT FROM accuracy_stat;

UPDATE public.abilities
   SET effect_config = effect_config - 'accuracy_stat'
 WHERE accuracy_stat IS NULL
   AND effect_config ? 'accuracy_stat';