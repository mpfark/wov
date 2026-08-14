/**
 * pure/effect-contract-sql.ts — the SQL side of the ONE effect contract.
 *
 * `buildEffectContractSql()` renders `public.validate_active_effect()` directly
 * from `EFFECT_MECHANIC_REGISTRY` + `EFFECT_PARAMS_VERSION`. The registry is
 * embedded in the function as a JSONB literal and the plpgsql body is generic:
 * it contains no hand-written per-mechanic rule, so SQL cannot drift from
 * TypeScript by construction.
 *
 * The rendered text is checked in at `supabase/contract/active_effects_validate.sql`
 * and installed verbatim by migration. Two permanent guards keep the three
 * copies aligned:
 *
 *  - `src/test/combat/effects/sql-parity.test.ts` fails when the generator
 *    output and the checked-in artifact differ, and when the artifact's
 *    embedded registry disagrees with the TypeScript registry on mechanics,
 *    source rules, target kinds, bounds, params, mutability or version.
 *  - the deployed harness (`c5-effect-harness`, case `contract_parity`)
 *    compares the artifact against the deployed `prosrc`.
 */

import {
  EFFECT_MECHANIC_REGISTRY,
  EFFECT_PARAMS_VERSION,
  type EffectMechanicSpec,
} from './effect-contract';

/** Mutable registry field -> `active_effects` column. */
export const EFFECT_MUTABLE_COLUMN: Readonly<Record<string, string>> = {
  remaining: 'remaining',
  stacks: 'stacks',
  nextTickAtMs: 'next_tick_at',
  expiresAtMs: 'expires_at',
  magnitude: 'magnitude',
  amountPerTick: 'damage_per_tick',
};

/** Columns an UPDATE may never touch once a row exists. */
export const EFFECT_IMMUTABLE_COLUMNS = [
  'node_id',
  'target_id',
  'source_id',
  'effect_type',
  'mechanic',
  'params',
  'params_version',
  'source_ability_key',
  'tick_rate_ms',
] as const;

/** Per-tick columns whose mutability is decided by the mechanic. */
export const EFFECT_TICK_COLUMNS = [
  'remaining',
  'stacks',
  'next_tick_at',
  'expires_at',
  'magnitude',
  'damage_per_tick',
] as const;

/** Stack bound enforced for every row, mechanic or not. */
export const EFFECT_STACKS_MAX = 99;

/** The registry projection that is embedded in SQL. Key order is stable. */
export function effectContractJson(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const mechanic of Object.keys(EFFECT_MECHANIC_REGISTRY).sort()) {
    const spec: EffectMechanicSpec = EFFECT_MECHANIC_REGISTRY[mechanic];
    const params: Record<string, unknown> = {};
    for (const key of Object.keys(spec.params).sort()) {
      const p = spec.params[key];
      params[key] = {
        kind: p.kind,
        ...(p.required ? { required: true } : {}),
        ...(p.integer ? { integer: true } : {}),
        ...(p.min !== undefined ? { min: p.min } : {}),
        ...(p.max !== undefined ? { max: p.max } : {}),
        ...(p.values ? { values: [...p.values] } : {}),
      };
    }
    out[mechanic] = {
      family: spec.family,
      target: spec.target,
      sourceMustBeCharacter: spec.sourceMustBeCharacter,
      periodic: spec.periodic,
      magnitude: { required: spec.magnitude.required, min: spec.magnitude.min, max: spec.magnitude.max },
      remaining: spec.remaining,
      stackPolicy: spec.stackPolicy,
      mutableColumns: spec.mutable.map((m) => EFFECT_MUTABLE_COLUMN[m]).filter(Boolean).sort(),
      params,
    };
  }
  return out;
}

/** Render the deployed validator. Deterministic: same registry -> same text. */
export function buildEffectContractSql(): string {
  const registry = JSON.stringify(effectContractJson());
  const immutable = EFFECT_IMMUTABLE_COLUMNS.map(
    (c) => `  IF NEW.${c} IS DISTINCT FROM OLD.${c} THEN
      RAISE EXCEPTION 'active_effects.${c}: immutable field may not change (% -> %)', OLD.${c}, NEW.${c}
        USING ERRCODE = 'check_violation';
    END IF;`,
  ).join('\n  ');
  const tick = EFFECT_TICK_COLUMNS.map(
    (c) => `    IF NOT ('${c}' = ANY (mutable)) AND NEW.${c} IS DISTINCT FROM OLD.${c} THEN
      RAISE EXCEPTION 'active_effects.${c}: not a mutable field for mechanic "%"', NEW.mechanic
        USING ERRCODE = 'check_violation';
    END IF;`,
  ).join('\n');

  return `-- GENERATED FILE - do not edit by hand.
-- Rendered by src/shared/combat/pure/effect-contract-sql.ts from
-- EFFECT_MECHANIC_REGISTRY. Regenerate with: bun run scripts/render-effect-contract-sql.ts
CREATE OR REPLACE FUNCTION public.validate_active_effect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  contract jsonb := $contract$${registry}$contract$::jsonb;
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

  IF NEW.params_version IS DISTINCT FROM ${EFFECT_PARAMS_VERSION} THEN
    RAISE EXCEPTION 'active_effects.params_version: expected ${EFFECT_PARAMS_VERSION}, received %', NEW.params_version
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.stacks IS NULL OR NEW.stacks < 0 OR NEW.stacks > ${EFFECT_STACKS_MAX} THEN
    RAISE EXCEPTION 'active_effects.stacks: expected 0..${EFFECT_STACKS_MAX}, received %', NEW.stacks
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
  ${immutable}

    mutable := ARRAY(SELECT jsonb_array_elements_text(spec -> 'mutableColumns'));
${tick}
  END IF;

  RETURN NEW;
END;
$fn$;
`;
}
