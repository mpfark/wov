update public.abilities
set label = 'Orbs of Fire',
    description = 'Stance. While in combat, an orb of fire pulses each heartbeat at your target — proc chance and spark damage scale with INT, and each spark applies the Ignite burn (stacks/duration scale with WIS). Mutually exclusive with Envenom. Click again to drop.',
    tooltip = 'Orbs strike your target and apply Ignite burn. Proc/spark scale with INT, burn with WIS. Stance.',
    admin_notes = coalesce(admin_notes, '') || ' Phase 5: stance label separated from the Ignite burn effect; ability_key stays "ignite".',
    updated_at = now()
where ability_key = 'ignite';

update public.abilities
set description = replace(description, 'stack count scales with WIS via Ignite.', 'stack count scales with WIS via Orbs of Fire.'),
    updated_at = now()
where ability_key = 'conflagrate';

update public.abilities
set description = replace(description, 'Mutually exclusive with Ignite.', 'Mutually exclusive with Orbs of Fire.'),
    updated_at = now()
where ability_key = 'envenom';