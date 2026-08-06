UPDATE public.base_abilities SET supports_secondary_scaling = true WHERE base_key = 'dot_debuff';

UPDATE public.abilities a SET secondary_attribute = x.secondary_attribute
FROM (
  SELECT ca.ability_id, c.secondary_attribute
  FROM public.class_ability_assignments ca
  JOIN public.classes c ON c.class_key = ca.class_key
) x
WHERE x.ability_id = a.id
  AND a.secondary_attribute IS NULL
  AND a.base_ability_id = (SELECT id FROM public.base_abilities WHERE base_key = 'dot_debuff');

-- Bases whose only attribute roles are primary do not need a second attribute.
UPDATE public.base_abilities SET supports_secondary_scaling = false WHERE base_key = 'absorb_self';
UPDATE public.abilities a SET secondary_attribute = NULL
WHERE a.base_ability_id = (SELECT id FROM public.base_abilities WHERE base_key = 'absorb_self');