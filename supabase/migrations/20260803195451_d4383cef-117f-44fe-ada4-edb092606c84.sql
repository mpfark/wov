insert into public.abilities (
  ability_key, label, description, tooltip, mechanic_key, ability_type, damage_type,
  target_type, activation_mode, cp_cost, amount_calc, duration_calc, interval_ms,
  effect_config, combat_text, mechanic_calcs, calc_version, status, admin_notes
) values (
  'frost_bolt', 'Frost Bolt',
  'A lance of splintering ice, slower to shape than flame but colder to the bone.',
  'Queued frost strike. Costs slightly more than Fireball and scales harder with Intellect.',
  'fireball', 'damage', 'frost', 'enemy', 'queued', 12,
  jsonb_build_object(
    'base', 3, 'floor', 1, 'cap', null, 'unit', 'hp', 'rounding', 'floor', 'version', 2,
    'note', '3 + 2.4x soft stat + level/3',
    'terms', jsonb_build_array(
      jsonb_build_object('source','stat','stat','int','mult',2.4,'rounding','round','clampAtZero',true,
        'transform', jsonb_build_object('kind','soft','profile','damage')),
      jsonb_build_object('source','level','mult',0.3333333333333333,'rounding','floor')
    )
  ),
  null, null,
  jsonb_build_object('resolved_by','combat-tick','stat','int'),
  '{}'::jsonb, '{}'::jsonb, 2, 'active',
  'Phase 4: first configured alternative technique (Wizard slot 1).'
)
on conflict (ability_key) do nothing;

insert into public.class_ability_assignments (class_key, role_id, ability_id, unlock_level, is_default, status)
select 'wizard', r.id, a.id, 1, false, 'active'
from public.class_ability_roles r
join public.abilities a on a.ability_key = 'frost_bolt'
where r.class_key = 'wizard' and r.slot = 1
on conflict do nothing;