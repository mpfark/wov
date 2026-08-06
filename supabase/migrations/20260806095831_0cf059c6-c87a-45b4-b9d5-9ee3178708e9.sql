UPDATE public.abilities
SET effect_config = effect_config
      || jsonb_build_object('ambush_stat', 'cha', 'duration_stat', 'dex', 'consumed_on_attack', true),
    updated_at = now()
WHERE mechanic_key = 'stealth_buff';

UPDATE public.abilities
SET effect_config = effect_config
      || jsonb_build_object('refresh_policy', COALESCE(effect_config->>'refresh_policy', 'best_of'),
                            'hp_stat', 'cha', 'cp_stat', 'cha', 'duration_stat', 'int',
                            'min_cp_per_tick', 1),
    updated_at = now()
WHERE mechanic_key = 'regen_buff';

UPDATE public.abilities
SET effect_config = effect_config
      || jsonb_build_object('magnitude_stat', 'wis', 'reserve_stat', 'con', 'min_reserve_hp', 1),
    combat_text = combat_text
      || jsonb_build_object('no_hp_text', 'You don''t have enough HP to transfer! (need to keep {reserve} HP)'),
    updated_at = now()
WHERE mechanic_key = 'hp_transfer';