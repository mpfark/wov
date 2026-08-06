-- Move remaining attribute selections onto named scaling roles.
UPDATE public.base_abilities SET
  effect_config = (effect_config - 'per_stack_stat')
    || jsonb_build_object('stat_roles',
         COALESCE(effect_config->'stat_roles','{}'::jsonb) || '{"per_stack_stat":"secondary"}'::jsonb,
       'stack_noun', 'poison'),
  supports_secondary_scaling = true
WHERE base_key = 'stack_consume_weapon';

UPDATE public.base_abilities SET
  effect_config = effect_config || jsonb_build_object('stack_noun', 'burn')
WHERE base_key = 'stack_consume_spell';

UPDATE public.base_abilities SET
  effect_config = (effect_config - 'cp_stat' - 'hp_stat')
    || jsonb_build_object('stat_roles',
         COALESCE(effect_config->'stat_roles','{}'::jsonb)
         || '{"cp_stat":"primary","hp_stat":"primary"}'::jsonb)
WHERE base_key = 'regen_buff';

UPDATE public.base_abilities SET
  effect_config = (effect_config - 'reserve_stat')
    || jsonb_build_object('stat_roles',
         COALESCE(effect_config->'stat_roles','{}'::jsonb) || '{"reserve_stat":"secondary"}'::jsonb)
WHERE base_key = 'hp_transfer';

UPDATE public.base_abilities SET
  effect_config = (effect_config - 'attack_stat')
    || jsonb_build_object('stat_roles',
         COALESCE(effect_config->'stat_roles','{}'::jsonb) || '{"attack_stat":"primary"}'::jsonb)
WHERE base_key = 'multi_attack';

UPDATE public.base_abilities SET
  effect_config = (effect_config - 'ambush_stat')
    || jsonb_build_object('stat_roles',
         COALESCE(effect_config->'stat_roles','{}'::jsonb) || '{"ambush_stat":"secondary"}'::jsonb)
WHERE base_key = 'stealth_buff';

UPDATE public.base_abilities SET
  effect_config = (effect_config - 'kicker_stat')
    || jsonb_build_object('stat_roles',
         COALESCE(effect_config->'stat_roles','{}'::jsonb) || '{"kicker_stat":"secondary"}'::jsonb)
WHERE base_key = 'reactive_holy';

-- The finisher's per-stack bonus uses the Assassin's secondary attribute.
UPDATE public.abilities a SET secondary_attribute = x.secondary_attribute
FROM (
  SELECT ca.ability_id, c.secondary_attribute
  FROM public.class_ability_assignments ca
  JOIN public.classes c ON c.class_key = ca.class_key
) x
WHERE x.ability_id = a.id
  AND a.ability_key = 'eviscerate';