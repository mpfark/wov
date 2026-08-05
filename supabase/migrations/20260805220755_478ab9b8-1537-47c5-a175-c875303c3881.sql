UPDATE public.abilities
SET amount_calc = jsonb_build_object(
      'base', 2,
      'terms', jsonb_build_array(jsonb_build_object('source','stat','stat','wis','mult',1,'role','primary')),
      'floor', 1, 'cap', null, 'unit', 'hp', 'note', 'heal per tick (primary attribute)'),
    duration_calc = jsonb_build_object(
      'base', 15000,
      'terms', jsonb_build_array(jsonb_build_object('source','stat','stat','con','mult',1000,'clampAtZero',true,'role','secondary')),
      'cap', 30000, 'unit', 'ms', 'note', 'duration (secondary attribute)'),
    effect_config = jsonb_build_object('ticking_party_heal', true, 'resolved_by', 'client-loop', 'source', 'healer', 'stat', 'wis', 'duration_stat', 'con'),
    combat_text = jsonb_build_object(
      'cast_text', 'Purifying Light! Divine radiance heals {who} every 3s for {seconds}s.',
      'tick_text', 'Purifying Light heals {who} for {amount} HP!'),
    updated_at = now()
WHERE ability_key = 'purifying_light';

UPDATE public.abilities
SET amount_calc = jsonb_build_object(
      'base', 2,
      'terms', jsonb_build_array(jsonb_build_object('source','stat','stat','cha','mult',1,'role','primary')),
      'floor', 1, 'cap', null, 'unit', 'hp', 'note', 'heal per tick (primary attribute)'),
    duration_calc = jsonb_build_object(
      'base', 15000,
      'terms', jsonb_build_array(jsonb_build_object('source','stat','stat','int','mult',1000,'clampAtZero',true,'role','secondary')),
      'cap', 30000, 'unit', 'ms', 'note', 'duration (secondary attribute)'),
    effect_config = jsonb_build_object('ticking_party_heal', true, 'resolved_by', 'client-loop', 'source', 'bard', 'stat', 'cha', 'duration_stat', 'int'),
    combat_text = jsonb_build_object(
      'cast_text', 'Crescendo! A rising melody heals {who} every 3s for {seconds}s.',
      'tick_text', 'Crescendo heals {who} for {amount} HP!'),
    updated_at = now()
WHERE ability_key = 'crescendo';