-- GENERATED FILE - do not edit by hand.
-- Rendered by src/shared/combat/pure/effect-contract-sql.ts from
-- EFFECT_MECHANIC_REGISTRY. Regenerate with: bun run scripts/render-effect-contract-sql.ts
CREATE OR REPLACE FUNCTION public.validate_active_effect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  contract jsonb := $contract${"absorb_buff":{"family":"friendly_state","target":"character","sourceMustBeCharacter":true,"periodic":false,"magnitude":{"required":true,"min":0,"max":1000000},"remaining":"pool","stackPolicy":"best_of","mutableColumns":["expires_at","remaining"],"params":{}},"aura_pulse":{"family":"persistent_area","target":"character","sourceMustBeCharacter":true,"periodic":true,"magnitude":{"required":false,"min":0,"max":1000000},"remaining":"unused","stackPolicy":"replace","mutableColumns":["damage_per_tick","expires_at","next_tick_at"],"params":{"cpPerTick":{"kind":"number","integer":true,"min":0,"max":100000},"damagesEnemies":{"kind":"boolean"},"healsAllies":{"kind":"boolean"}}},"block_buff":{"family":"defensive_state","target":"character","sourceMustBeCharacter":true,"periodic":false,"magnitude":{"required":true,"min":0,"max":1},"remaining":"unused","stackPolicy":"replace","mutableColumns":["expires_at","magnitude"],"params":{"blockAmount":{"kind":"number","min":0,"max":1000},"blockChanceCap":{"kind":"number","min":0,"max":1}}},"control_debuff":{"family":"hostile_state","target":"creature","sourceMustBeCharacter":true,"periodic":false,"magnitude":{"required":false,"min":0,"max":1},"remaining":"unused","stackPolicy":"replace","mutableColumns":["expires_at"],"params":{"ampPct":{"kind":"number","min":0,"max":10}}},"dot_debuff":{"family":"hostile_periodic","target":"creature","sourceMustBeCharacter":true,"periodic":true,"magnitude":{"required":false,"min":0,"max":1000000},"remaining":"unused","stackPolicy":"stacking","mutableColumns":["damage_per_tick","expires_at","next_tick_at","stacks"],"params":{"damageType":{"kind":"string"},"maxStacks":{"kind":"number","integer":true,"min":1,"max":99}}},"evasion_buff":{"family":"defensive_state","target":"character","sourceMustBeCharacter":true,"periodic":false,"magnitude":{"required":true,"min":0,"max":100},"remaining":"charges","stackPolicy":"replace","mutableColumns":["expires_at","magnitude","remaining"],"params":{"evasionSource":{"kind":"enum","required":true,"values":["cloak","disengage"]},"kind":{"kind":"enum","required":true,"values":["dodge","next_hit"]}}},"mitigation_buff":{"family":"friendly_state","target":"character","sourceMustBeCharacter":true,"periodic":false,"magnitude":{"required":true,"min":0,"max":1000000},"remaining":"unused","stackPolicy":"best_of","mutableColumns":["expires_at","magnitude"],"params":{"mode":{"kind":"enum","required":true,"values":["percent","flat"]},"taunt":{"kind":"boolean"}}},"offense_buff":{"family":"friendly_state","target":"character","sourceMustBeCharacter":true,"periodic":false,"magnitude":{"required":true,"min":0,"max":100},"remaining":"unused","stackPolicy":"best_of","mutableColumns":["expires_at","magnitude"],"params":{"offenseMode":{"kind":"enum","required":true,"values":["damage_mult","crit_edge"]}}},"party_regen":{"family":"party_regen","target":"character","sourceMustBeCharacter":true,"periodic":true,"magnitude":{"required":false,"min":0,"max":1000000},"remaining":"unused","stackPolicy":"best_of","mutableColumns":["damage_per_tick","expires_at","next_tick_at"],"params":{"cpPerTick":{"kind":"number","integer":true,"min":0,"max":100000},"damagesEnemies":{"kind":"boolean"},"healsAllies":{"kind":"boolean"}}},"reactive_holy":{"family":"reactive_state","target":"character","sourceMustBeCharacter":true,"periodic":false,"magnitude":{"required":true,"min":1,"max":1000000},"remaining":"unused","stackPolicy":"best_of","mutableColumns":["expires_at","magnitude"],"params":{"damageType":{"kind":"string"}}},"regen_buff":{"family":"periodic_friendly_state","target":"character","sourceMustBeCharacter":true,"periodic":true,"magnitude":{"required":false,"min":0,"max":1000000},"remaining":"unused","stackPolicy":"best_of","mutableColumns":["damage_per_tick","expires_at","next_tick_at"],"params":{"cpPerTick":{"kind":"number","integer":true,"min":0,"max":100000},"damagesEnemies":{"kind":"boolean"},"healsAllies":{"kind":"boolean"}}},"stack_apply":{"family":"stack_source","target":"character","sourceMustBeCharacter":true,"periodic":false,"magnitude":{"required":true,"min":0,"max":1},"remaining":"unused","stackPolicy":"replace","mutableColumns":["expires_at","magnitude"],"params":{"damageType":{"kind":"string"},"dotPerTick":{"kind":"number","required":true,"min":0,"max":1000000},"durationMs":{"kind":"number","required":true,"integer":true,"min":0,"max":3600000},"intervalMs":{"kind":"number","required":true,"integer":true,"min":250,"max":600000},"maxStacks":{"kind":"number","required":true,"integer":true,"min":1,"max":99},"pulseDamage":{"kind":"number","min":0,"max":1000000},"stackEffectType":{"kind":"string","required":true},"trigger":{"kind":"enum","required":true,"values":["weapon_hit","successful_pulse_hit"]}}},"stealth_buff":{"family":"stealth_state","target":"character","sourceMustBeCharacter":true,"periodic":false,"magnitude":{"required":true,"min":1,"max":100},"remaining":"charges","stackPolicy":"replace","mutableColumns":["expires_at","magnitude","remaining"],"params":{}}}$contract$::jsonb;
  spec jsonb;
  rec record;
  pkey text;
  pval jsonb;
  pkind text;
  num numeric;
  mutable text[];
BEGIN
  IF NEW.params IS NULL OR jsonb_typeof(NEW.params) <> 'object' THEN
    RAISE EXCEPTION 'active_effects.params: expected an object'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.params_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'active_effects.params_version: expected 1, received %', NEW.params_version
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.stacks IS NULL OR NEW.stacks < 0 OR NEW.stacks > 99 THEN
    RAISE EXCEPTION 'active_effects.stacks: expected 0..99, received %', NEW.stacks
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.mechanic IS NULL THEN
    IF NEW.params <> '{}'::jsonb THEN
      RAISE EXCEPTION 'active_effects.params: params require a registered mechanic'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  spec := contract -> NEW.mechanic;
  IF spec IS NULL THEN
    RAISE EXCEPTION 'active_effects.mechanic: unknown effect mechanic "%"', NEW.mechanic
      USING ERRCODE = 'check_violation';
  END IF;

  -- Target kind is derived from the row the target_id actually points at.
  IF spec ->> 'target' = 'creature' THEN
    IF NOT EXISTS (SELECT 1 FROM public.creatures WHERE id = NEW.target_id) THEN
      RAISE EXCEPTION 'active_effects.targetKind: mechanic "%" targets creature, received character/unknown %',
        NEW.mechanic, NEW.target_id USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.characters WHERE id = NEW.target_id) THEN
      RAISE EXCEPTION 'active_effects.targetKind: mechanic "%" targets character, received creature/unknown %',
        NEW.mechanic, NEW.target_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF (spec ->> 'sourceMustBeCharacter')::boolean
     AND (NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.characters WHERE id = NEW.source_id)) THEN
    RAISE EXCEPTION 'active_effects.sourceCharacterId: mechanic "%" requires a character source', NEW.mechanic
      USING ERRCODE = 'check_violation';
  END IF;

  IF (spec ->> 'periodic')::boolean AND coalesce(NEW.tick_rate_ms, 0) <= 0 THEN
    RAISE EXCEPTION 'active_effects.intervalMs: periodic mechanic "%" requires tick_rate_ms > 0', NEW.mechanic
      USING ERRCODE = 'check_violation';
  END IF;

  IF (spec -> 'magnitude' ->> 'required')::boolean AND NEW.magnitude IS NULL THEN
    RAISE EXCEPTION 'active_effects.magnitude: mechanic "%" requires a finite magnitude', NEW.mechanic
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.magnitude IS NOT NULL
     AND (NEW.magnitude < (spec -> 'magnitude' ->> 'min')::numeric
          OR NEW.magnitude > (spec -> 'magnitude' ->> 'max')::numeric) THEN
    RAISE EXCEPTION 'active_effects.magnitude: expected %..%, received %',
      spec -> 'magnitude' ->> 'min', spec -> 'magnitude' ->> 'max', NEW.magnitude
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.remaining IS NOT NULL THEN
    IF spec ->> 'remaining' = 'unused' THEN
      RAISE EXCEPTION 'active_effects.remaining: mechanic "%" has no remaining pool/charges', NEW.mechanic
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.remaining < 0 THEN
      RAISE EXCEPTION 'active_effects.remaining: expected a finite value >= 0, received %', NEW.remaining
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  FOR pkey IN SELECT jsonb_object_keys(NEW.params) LOOP
    IF spec -> 'params' -> pkey IS NULL THEN
      RAISE EXCEPTION 'active_effects.params.%: parameter is not allowed for mechanic "%"', pkey, NEW.mechanic
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  FOR rec IN SELECT key, value FROM jsonb_each(spec -> 'params') LOOP
    pval := NEW.params -> rec.key;
    IF pval IS NULL OR jsonb_typeof(pval) = 'null' THEN
      IF coalesce((rec.value ->> 'required')::boolean, false) THEN
        RAISE EXCEPTION 'active_effects.params.%: required parameter for mechanic "%"', rec.key, NEW.mechanic
          USING ERRCODE = 'check_violation';
      END IF;
      CONTINUE;
    END IF;
    pkind := rec.value ->> 'kind';
    IF pkind = 'boolean' THEN
      IF jsonb_typeof(pval) <> 'boolean' THEN
        RAISE EXCEPTION 'active_effects.params.%: expected boolean, received %', rec.key, jsonb_typeof(pval)
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF pkind = 'string' THEN
      IF jsonb_typeof(pval) <> 'string' OR length(pval #>> '{}') = 0 THEN
        RAISE EXCEPTION 'active_effects.params.%: expected non-empty string', rec.key
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF pkind = 'enum' THEN
      IF jsonb_typeof(pval) <> 'string'
         OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(rec.value -> 'values') v WHERE v = pval #>> '{}') THEN
        RAISE EXCEPTION 'active_effects.params.%: expected one of %, received %',
          rec.key, rec.value ->> 'values', pval #>> '{}'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF jsonb_typeof(pval) <> 'number' THEN
        RAISE EXCEPTION 'active_effects.params.%: expected finite number, received %', rec.key, pval #>> '{}'
          USING ERRCODE = 'check_violation';
      END IF;
      num := (pval #>> '{}')::numeric;
      IF coalesce((rec.value ->> 'integer')::boolean, false) AND num <> trunc(num) THEN
        RAISE EXCEPTION 'active_effects.params.%: expected an integer, received %', rec.key, num
          USING ERRCODE = 'check_violation';
      END IF;
      IF rec.value ? 'min' AND num < (rec.value ->> 'min')::numeric THEN
        RAISE EXCEPTION 'active_effects.params.%: expected >= %, received %', rec.key, rec.value ->> 'min', num
          USING ERRCODE = 'check_violation';
      END IF;
      IF rec.value ? 'max' AND num > (rec.value ->> 'max')::numeric THEN
        RAISE EXCEPTION 'active_effects.params.%: expected <= %, received %', rec.key, rec.value ->> 'max', num
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END LOOP;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.node_id IS DISTINCT FROM OLD.node_id THEN
      RAISE EXCEPTION 'active_effects.node_id: immutable field may not change (% -> %)', OLD.node_id, NEW.node_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.target_id IS DISTINCT FROM OLD.target_id THEN
      RAISE EXCEPTION 'active_effects.target_id: immutable field may not change (% -> %)', OLD.target_id, NEW.target_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.source_id IS DISTINCT FROM OLD.source_id THEN
      RAISE EXCEPTION 'active_effects.source_id: immutable field may not change (% -> %)', OLD.source_id, NEW.source_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.effect_type IS DISTINCT FROM OLD.effect_type THEN
      RAISE EXCEPTION 'active_effects.effect_type: immutable field may not change (% -> %)', OLD.effect_type, NEW.effect_type
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.mechanic IS DISTINCT FROM OLD.mechanic THEN
      RAISE EXCEPTION 'active_effects.mechanic: immutable field may not change (% -> %)', OLD.mechanic, NEW.mechanic
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.params IS DISTINCT FROM OLD.params THEN
      RAISE EXCEPTION 'active_effects.params: immutable field may not change (% -> %)', OLD.params, NEW.params
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.params_version IS DISTINCT FROM OLD.params_version THEN
      RAISE EXCEPTION 'active_effects.params_version: immutable field may not change (% -> %)', OLD.params_version, NEW.params_version
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.source_ability_key IS DISTINCT FROM OLD.source_ability_key THEN
      RAISE EXCEPTION 'active_effects.source_ability_key: immutable field may not change (% -> %)', OLD.source_ability_key, NEW.source_ability_key
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tick_rate_ms IS DISTINCT FROM OLD.tick_rate_ms THEN
      RAISE EXCEPTION 'active_effects.tick_rate_ms: immutable field may not change (% -> %)', OLD.tick_rate_ms, NEW.tick_rate_ms
        USING ERRCODE = 'check_violation';
    END IF;

    mutable := ARRAY(SELECT jsonb_array_elements_text(spec -> 'mutableColumns'));
    IF NOT ('remaining' = ANY (mutable)) AND NEW.remaining IS DISTINCT FROM OLD.remaining THEN
      RAISE EXCEPTION 'active_effects.remaining: not a mutable field for mechanic "%"', NEW.mechanic
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ('stacks' = ANY (mutable)) AND NEW.stacks IS DISTINCT FROM OLD.stacks THEN
      RAISE EXCEPTION 'active_effects.stacks: not a mutable field for mechanic "%"', NEW.mechanic
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ('next_tick_at' = ANY (mutable)) AND NEW.next_tick_at IS DISTINCT FROM OLD.next_tick_at THEN
      RAISE EXCEPTION 'active_effects.next_tick_at: not a mutable field for mechanic "%"', NEW.mechanic
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ('expires_at' = ANY (mutable)) AND NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION 'active_effects.expires_at: not a mutable field for mechanic "%"', NEW.mechanic
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ('magnitude' = ANY (mutable)) AND NEW.magnitude IS DISTINCT FROM OLD.magnitude THEN
      RAISE EXCEPTION 'active_effects.magnitude: not a mutable field for mechanic "%"', NEW.mechanic
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ('damage_per_tick' = ANY (mutable)) AND NEW.damage_per_tick IS DISTINCT FROM OLD.damage_per_tick THEN
      RAISE EXCEPTION 'active_effects.damage_per_tick: not a mutable field for mechanic "%"', NEW.mechanic
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;
