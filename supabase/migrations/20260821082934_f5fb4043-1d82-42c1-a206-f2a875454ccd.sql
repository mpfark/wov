update public.abilities
set combat_text = jsonb_set(combat_text, '{activate_text}', to_jsonb('Ignite! A shield of fireballs orbits you — each heartbeat in combat, an orb may strike your target.'::text), true)
where ability_key = 'ignite';

update public.abilities
set combat_text = jsonb_set(
      jsonb_set(combat_text, '{activate_text}', to_jsonb('Envenom! Your weapons drip with poison.'::text), true),
      '{stack_text}', to_jsonb($$ {attacker}'s venom seeps into {target} (poison x{stacks}). $$::text), true)
where ability_key = 'envenom';

update public.abilities
set combat_text = jsonb_set(combat_text, '{stack_text}', to_jsonb(trim(combat_text->>'stack_text')), true)
where ability_key = 'envenom';