ALTER TABLE public.node_effect
  DROP CONSTRAINT node_effect_target_chk;

ALTER TABLE public.node_effect
  ADD CONSTRAINT node_effect_target_chk CHECK (
    (kind = 'autoattack'
      AND target_character_id IS NOT NULL
      AND target_creature_id IS NOT NULL)
    OR
    (kind <> 'autoattack'
      AND ((target_character_id IS NOT NULL) <> (target_creature_id IS NOT NULL)))
  );