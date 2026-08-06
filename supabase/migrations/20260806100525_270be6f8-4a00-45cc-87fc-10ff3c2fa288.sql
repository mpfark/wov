UPDATE public.class_ability_assignments
SET overrides = jsonb_set(
      overrides,
      '{combat_text}',
      COALESCE(overrides->'combat_text', '{}'::jsonb)
        || jsonb_build_object(
             'hit_text',  '{caster}''s blade finds a vital point on {target} from behind. [{damage}]',
             'miss_text', '{caster}''s blade slips wide — {target} is untouched.'
           ),
      true
    ),
    updated_at = now()
WHERE class_ability_key = 'backstab';