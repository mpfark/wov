-- Preserve the legacy curves exactly: Force Shield's INT duration term was not
-- clamped at zero, and Divine Aegis' pool had no floor.
UPDATE public.abilities
SET duration_calc = jsonb_build_object(
      'base', 8000, 'cap', 15000, 'unit', 'ms',
      'note', 'shield duration (secondary attribute)',
      'terms', jsonb_build_array(
        jsonb_build_object('source','stat','stat','int','mult',1000,'role','secondary')
      )
    ),
    updated_at = now()
WHERE ability_key = 'force_shield';

UPDATE public.abilities
SET amount_calc = jsonb_set(amount_calc, '{floor}', 'null'::jsonb),
    updated_at = now()
WHERE ability_key = 'divine_aegis';