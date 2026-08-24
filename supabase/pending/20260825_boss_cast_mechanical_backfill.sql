-- Boss-cast mechanical backfill — PREPARED, NOT APPLIED.
--
-- Brings the 28 REVIEWED boss_cast rows onto the canonical shape the shared
-- normalizer reads, without changing a single authored balance value.
--
-- SCOPE IS FROZEN. The manifest below lists every creature id this migration is
-- allowed to touch, together with the label, the identity the runtime fallback
-- already resolves, and the explicit `enabled` the historical rarity rule
-- implies. The same 28 images are frozen in
-- src/test/combat/c3/fixtures/boss-cast-production-images.ts, so the migration
-- and the runtime-parity test speak about exactly the same rows. If production
-- has drifted (a row added, removed, relabelled or re-rarified since review),
-- pre-flight aborts instead of writing to an unreviewed row.
--
-- What it writes:
--   * ability_key   — stable identity, derived with EXACTLY the runtime rule
--                     (slugify(label) || '__' || left(hex(id), 8)); asserted
--                     equal to the reviewed manifest value. Rows that already
--                     carry a key are never rewritten.
--   * enabled       — made explicit using the historical rule: bosses opt out,
--                     rares opt in. Absent -> (rarity = 'boss').
--   * cast_ms /
--     cooldown_ms   — filled with the contract defaults (4000 / 20000) only
--                     when absent or non-positive.
--   * base_amount   — promoted from the legacy `amount` mirror when missing.
--   * amount        — REMOVED, so no value has two homes.
--   * base_aoe_amount, chance, lock_ms, target_mode, stored_power shares,
--     accumulate.* — control fields filled only when absent, with the contract
--     defaults.
--
-- What it deliberately does NOT do:
--   * no damage, chance, cooldown, lock, AC or crit-threshold changes;
--   * no damage_type guessing (rows without one keep it absent; a missing type
--     is presentation-only and does not block a cast);
--   * no invented flavor prose — missing cast_flavor / hit_flavor stay missing
--     and are handled as a separate reviewed content change;
--   * no writes outside the manifest ids.
--
-- Idempotent: rerunning produces byte-identical values.

BEGIN;

-- ── Frozen manifest (28 reviewed rows) ───────────────────────────────────────
CREATE TEMP TABLE boss_cast_manifest (
  creature_id uuid PRIMARY KEY,
  name text NOT NULL,
  rarity text NOT NULL,
  label text NOT NULL,
  expected_key text NOT NULL,
  expected_enabled boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO boss_cast_manifest
  (creature_id, name, rarity, label, expected_key, expected_enabled)
VALUES
@@VALUES@@;

-- Transaction-scoped before-image of every manifest row. Post-flight compares
-- against it, then it is dropped with the transaction, so nothing persists.
CREATE TEMP TABLE boss_cast_before ON COMMIT DROP AS
SELECT c.id AS creature_id, c.rarity::text AS rarity, c.boss_cast
FROM public.creatures c
JOIN boss_cast_manifest m ON m.creature_id = c.id;

-- ── Pre-flight: production must still match the reviewed manifest ────────────
DO $$
DECLARE
  v_manifest int;
  v_matched int;
  v_configured int;
  v_unreviewed int;
  v_bad int;
BEGIN
  SELECT count(*) INTO v_manifest FROM boss_cast_manifest;
  IF v_manifest <> 28 THEN
    RAISE EXCEPTION 'boss-cast backfill aborted: manifest holds % rows, expected 28', v_manifest;
  END IF;

  SELECT count(*) INTO v_matched FROM boss_cast_before;
  IF v_matched <> 28 THEN
    RAISE EXCEPTION 'boss-cast backfill aborted: % of 28 manifest creatures found', v_matched;
  END IF;

  -- No configured cast may exist outside the reviewed set.
  SELECT count(*) INTO v_configured
  FROM public.creatures
  WHERE boss_cast IS NOT NULL AND jsonb_typeof(boss_cast) = 'object';
  SELECT count(*) INTO v_unreviewed
  FROM public.creatures c
  WHERE c.boss_cast IS NOT NULL AND jsonb_typeof(c.boss_cast) = 'object'
    AND NOT EXISTS (SELECT 1 FROM boss_cast_manifest m WHERE m.creature_id = c.id);
  RAISE NOTICE 'boss-cast backfill: % configured rows, % reviewed', v_configured, v_manifest;
  IF v_unreviewed > 0 THEN
    RAISE EXCEPTION 'boss-cast backfill aborted: % configured rows are not in the reviewed manifest', v_unreviewed;
  END IF;

  -- Every manifest row must still be an object and still carry the reviewed
  -- rarity and label — those two inputs decide identity and eligibility.
  SELECT count(*) INTO v_bad
  FROM boss_cast_before b
  JOIN boss_cast_manifest m ON m.creature_id = b.creature_id
  WHERE b.boss_cast IS NULL
     OR jsonb_typeof(b.boss_cast) <> 'object'
     OR b.rarity <> m.rarity
     OR coalesce(nullif(trim(b.boss_cast->>'label'), ''), 'Cataclysm') <> m.label;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'boss-cast backfill aborted: % manifest rows drifted (rarity/label/shape)', v_bad;
  END IF;

  -- The runtime fallback rule, recomputed in SQL, must equal the reviewed key.
  SELECT count(*) INTO v_bad
  FROM boss_cast_before b
  JOIN boss_cast_manifest m ON m.creature_id = b.creature_id
  WHERE coalesce(
          nullif(trim(b.boss_cast->>'ability_key'), ''),
          nullif(trim(b.boss_cast->>'cast_key'), ''),
          trim(both '_' from regexp_replace(
            lower(coalesce(nullif(trim(b.boss_cast->>'label'), ''), 'Cataclysm')),
            '[^a-z0-9]+', '_', 'g'))
            || '__' || left(replace(b.creature_id::text, '-', ''), 8)
        ) <> m.expected_key;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'boss-cast backfill aborted: % rows derive an identity other than the reviewed one', v_bad;
  END IF;

  -- Reviewed identities must be unique table-wide.
  SELECT count(*) INTO v_bad FROM (
    SELECT expected_key FROM boss_cast_manifest GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'boss-cast backfill aborted: % duplicate reviewed identities', v_bad;
  END IF;
END $$;

-- ── Backfill (manifest rows only) ────────────────────────────────────────────
UPDATE public.creatures c
SET boss_cast = (
  (c.boss_cast - 'amount')
  || jsonb_build_object(
       'ability_key', coalesce(
          nullif(trim(c.boss_cast->>'ability_key'), ''),
          nullif(trim(c.boss_cast->>'cast_key'), ''),
          m.expected_key
       ),
       'label', m.label,
       'enabled', CASE
         WHEN jsonb_typeof(c.boss_cast->'enabled') = 'boolean'
           THEN (c.boss_cast->'enabled')
         ELSE to_jsonb(m.expected_enabled)
       END,
       'cast_ms', CASE
         WHEN coalesce((c.boss_cast->>'cast_ms')::numeric, 0) > 0
           THEN c.boss_cast->'cast_ms' ELSE to_jsonb(4000) END,
       'cooldown_ms', CASE
         WHEN coalesce((c.boss_cast->>'cooldown_ms')::numeric, 0) > 0
           THEN c.boss_cast->'cooldown_ms' ELSE to_jsonb(20000) END,
       'chance', CASE
         WHEN jsonb_typeof(c.boss_cast->'chance') = 'number'
           THEN c.boss_cast->'chance' ELSE to_jsonb(0.30) END,
       'lock_ms', CASE
         WHEN jsonb_typeof(c.boss_cast->'lock_ms') = 'number'
           THEN c.boss_cast->'lock_ms' ELSE to_jsonb(0) END,
       'base_amount', coalesce(
          CASE WHEN jsonb_typeof(c.boss_cast->'base_amount') = 'number'
               THEN c.boss_cast->'base_amount' END,
          CASE WHEN jsonb_typeof(c.boss_cast->'amount') = 'number'
               THEN c.boss_cast->'amount' END,
          to_jsonb(0)
       ),
       'base_aoe_amount', CASE
         WHEN jsonb_typeof(c.boss_cast->'base_aoe_amount') = 'number'
           THEN c.boss_cast->'base_aoe_amount' ELSE to_jsonb(0) END,
       'target_mode', CASE
         WHEN c.boss_cast->>'target_mode' IN ('tank_preferred', 'tank_strict', 'random_alive')
           THEN c.boss_cast->'target_mode' ELSE '"tank_preferred"'::jsonb END,
       'stored_power', coalesce(c.boss_cast->'stored_power', '{}'::jsonb)
         || jsonb_build_object(
              'consume_mode', coalesce(c.boss_cast->'stored_power'->'consume_mode', '"all"'::jsonb),
              'consume_pct', coalesce(c.boss_cast->'stored_power'->'consume_pct', to_jsonb(100)),
              'primary_share', coalesce(c.boss_cast->'stored_power'->'primary_share', to_jsonb(1.0)),
              'aoe_share', coalesce(c.boss_cast->'stored_power'->'aoe_share', to_jsonb(0.4))
            ),
       'accumulate', coalesce(c.boss_cast->'accumulate', '{}'::jsonb)
         || jsonb_build_object(
              'enabled', CASE
                WHEN jsonb_typeof(c.boss_cast->'accumulate'->'enabled') = 'boolean'
                  THEN c.boss_cast->'accumulate'->'enabled' ELSE to_jsonb(true) END,
              'pause_autoattacks', CASE
                WHEN jsonb_typeof(c.boss_cast->'accumulate'->'pause_autoattacks') = 'boolean'
                  THEN c.boss_cast->'accumulate'->'pause_autoattacks' ELSE to_jsonb(true) END,
              'source', coalesce(c.boss_cast->'accumulate'->'source', '"primary_target"'::jsonb),
              'method', coalesce(c.boss_cast->'accumulate'->'method', '"expected"'::jsonb),
              'crit_during_cast', coalesce(
                c.boss_cast->'accumulate'->'crit_during_cast', '"disabled"'::jsonb)
            )
     )
)
FROM boss_cast_manifest m
WHERE m.creature_id = c.id
  AND c.boss_cast IS NOT NULL
  AND jsonb_typeof(c.boss_cast) = 'object';

-- ── Post-flight ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad int;
  v_rows int;
BEGIN
  SELECT count(*) INTO v_rows
  FROM public.creatures c JOIN boss_cast_manifest m ON m.creature_id = c.id;
  IF v_rows <> 28 THEN
    RAISE EXCEPTION 'boss-cast backfill post-flight: % of 28 manifest rows present', v_rows;
  END IF;

  -- Canonical shape reached on every manifest row.
  SELECT count(*) INTO v_bad
  FROM public.creatures c
  JOIN boss_cast_manifest m ON m.creature_id = c.id
  WHERE nullif(trim(c.boss_cast->>'ability_key'), '') IS DISTINCT FROM m.expected_key
     OR jsonb_typeof(c.boss_cast->'enabled') <> 'boolean'
     OR coalesce((c.boss_cast->>'cast_ms')::numeric, 0) <= 0
     OR coalesce((c.boss_cast->>'cooldown_ms')::numeric, 0) <= 0
     OR jsonb_typeof(c.boss_cast->'chance') <> 'number'
     OR jsonb_typeof(c.boss_cast->'base_amount') <> 'number'
     OR jsonb_typeof(c.boss_cast->'base_aoe_amount') <> 'number'
     OR c.boss_cast ? 'amount';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'boss-cast backfill post-flight failed on % rows', v_bad;
  END IF;

  -- Every authored value is byte-identical to its before-image. `base_amount`
  -- may only equal the before-image value or the legacy `amount` mirror.
  SELECT count(*) INTO v_bad
  FROM public.creatures c
  JOIN boss_cast_before b ON b.creature_id = c.id
  WHERE (c.boss_cast->'cast_ms')         IS DISTINCT FROM coalesce(b.boss_cast->'cast_ms', to_jsonb(4000))
     OR (c.boss_cast->'cooldown_ms')     IS DISTINCT FROM coalesce(b.boss_cast->'cooldown_ms', to_jsonb(20000))
     OR (c.boss_cast->'chance')          IS DISTINCT FROM coalesce(b.boss_cast->'chance', to_jsonb(0.30))
     OR (c.boss_cast->'lock_ms')         IS DISTINCT FROM coalesce(b.boss_cast->'lock_ms', to_jsonb(0))
     OR (c.boss_cast->'base_aoe_amount') IS DISTINCT FROM coalesce(b.boss_cast->'base_aoe_amount', to_jsonb(0))
     OR (c.boss_cast->'damage_type')     IS DISTINCT FROM (b.boss_cast->'damage_type')
     OR (c.boss_cast->'cast_flavor')     IS DISTINCT FROM (b.boss_cast->'cast_flavor')
     OR (c.boss_cast->'hit_flavor')      IS DISTINCT FROM (b.boss_cast->'hit_flavor')
     OR (c.boss_cast->'stored_power'->'cap')
          IS DISTINCT FROM (b.boss_cast->'stored_power'->'cap')
     OR (c.boss_cast->'stored_power'->'primary_share')
          IS DISTINCT FROM coalesce(b.boss_cast->'stored_power'->'primary_share', to_jsonb(1.0))
     OR (c.boss_cast->'stored_power'->'aoe_share')
          IS DISTINCT FROM coalesce(b.boss_cast->'stored_power'->'aoe_share', to_jsonb(0.4))
     OR (c.boss_cast->'stored_power'->'consume_mode')
          IS DISTINCT FROM coalesce(b.boss_cast->'stored_power'->'consume_mode', '"all"'::jsonb)
     OR (c.boss_cast->'base_amount') IS DISTINCT FROM coalesce(
          b.boss_cast->'base_amount', b.boss_cast->'amount', to_jsonb(0));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'boss-cast backfill post-flight: % rows changed an authored value', v_bad;
  END IF;

  -- No key was dropped except the retired `amount` mirror.
  SELECT count(*) INTO v_bad
  FROM public.creatures c
  JOIN boss_cast_before b ON b.creature_id = c.id
  WHERE EXISTS (
    SELECT 1 FROM jsonb_object_keys(b.boss_cast) k
    WHERE k <> 'amount' AND NOT (c.boss_cast ? k)
  );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'boss-cast backfill post-flight: % rows lost an authored key', v_bad;
  END IF;

  -- An enabled cast must be able to land damage; report rather than block.
  SELECT count(*) INTO v_bad
  FROM public.creatures c
  JOIN boss_cast_manifest m ON m.creature_id = c.id
  WHERE (c.boss_cast->>'enabled')::boolean
    AND coalesce((c.boss_cast->>'base_amount')::numeric, 0) <= 0
    AND coalesce((c.boss_cast->>'base_aoe_amount')::numeric, 0) <= 0
    AND coalesce((c.boss_cast->'stored_power'->>'cap')::numeric, 0) <= 0;
  IF v_bad > 0 THEN
    RAISE NOTICE 'boss-cast backfill: % enabled rows have no authored damage (level curve fallback applies)', v_bad;
  END IF;
END $$;

COMMIT;
