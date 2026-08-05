-- Phase 6: consolidate absorb shields onto the shared `absorb_buff` base.
-- Divine Aegis moves off the class-specific `ally_absorb` mechanic; its ally
-- targeting now comes from target_type, and its wording from combat_text.

-- 1) Temporarily retire so guard_ability_identity allows the mechanic change.
UPDATE public.class_ability_assignments a
SET status = 'retired'
WHERE a.ability_id = (SELECT id FROM public.abilities WHERE ability_key = 'divine_aegis');

UPDATE public.abilities SET status = 'retired' WHERE ability_key = 'divine_aegis';

UPDATE public.abilities
SET mechanic_key = 'absorb_buff',
    amount_calc = jsonb_build_object(
      'base', 0, 'floor', 1, 'cap', null, 'unit', 'hp',
      'note', 'shield pool (primary attribute)',
      'terms', jsonb_build_array(
        jsonb_build_object('source','stat','stat','wis','mult',2,'role','primary'),
        jsonb_build_object('source','level','mult',0.7,'rounding','floor')
      )
    ),
    duration_calc = jsonb_build_object(
      'base', 30000, 'cap', 60000, 'unit', 'ms',
      'note', 'shield duration (secondary attribute)',
      'terms', jsonb_build_array(
        jsonb_build_object('source','stat','stat','con','mult',2000,'clampAtZero',true,'role','secondary')
      )
    ),
    effect_config = jsonb_build_object(
      'absorb_shield', true, 'resolved_by', 'client-cast', 'stat', 'wis', 'duration_stat', 'con'
    ),
    combat_text = jsonb_build_object(
      'self_text', 'Divine Aegis! An absorb shield wraps you for up to {seconds}s.',
      'ally_text', 'Divine Aegis! You shield {target} for up to {seconds}s.'
    ),
    updated_at = now()
WHERE ability_key = 'divine_aegis';

UPDATE public.abilities SET status = 'active' WHERE ability_key = 'divine_aegis';

UPDATE public.class_ability_assignments a
SET status = 'active'
WHERE a.ability_id = (SELECT id FROM public.abilities WHERE ability_key = 'divine_aegis');

-- 2) Force Shield: role-tag its calcs and author its shield text (same curves).
UPDATE public.abilities
SET amount_calc = jsonb_build_object(
      'base', 0, 'floor', 1, 'cap', null, 'unit', 'hp',
      'note', 'shield pool (primary attribute)',
      'terms', jsonb_build_array(
        jsonb_build_object('source','stat','stat','wis','mult',1,'role','primary'),
        jsonb_build_object('source','level','mult',0.5,'rounding','floor')
      )
    ),
    duration_calc = jsonb_build_object(
      'base', 8000, 'cap', 15000, 'unit', 'ms',
      'note', 'shield duration (secondary attribute)',
      'terms', jsonb_build_array(
        jsonb_build_object('source','stat','stat','int','mult',1000,'clampAtZero',true,'role','secondary')
      )
    ),
    effect_config = jsonb_build_object(
      'absorb_shield', true, 'resolved_by', 'client-cast', 'stat', 'wis',
      'duration_stat', 'int', 'regen_stat', 'int', 'reforms_out_of_combat', true
    ),
    combat_text = jsonb_build_object(
      'self_text', 'Force Shield! An arcane ward wraps you for {seconds}s.',
      'ally_text', 'Force Shield! You ward {target} for {seconds}s.'
    ),
    updated_at = now()
WHERE ability_key = 'force_shield';