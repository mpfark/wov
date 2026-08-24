-- Boss-cast mechanical backfill — PREPARED, NOT APPLIED.
--
-- Brings every configured boss_cast row onto the canonical shape the shared
-- normalizer reads, without changing a single authored balance value.
--
-- What it writes:
--   * ability_key   — stable identity, derived with EXACTLY the runtime rule
--                     (slugify(label) || '__' || left(hex(id), 8)), so the key
--                     equals what the decoder fallback already resolves today.
--                     Rows that already carry a key are never rewritten.
--   * enabled       — made explicit using the historical rule: bosses opt out,
--                     rares opt in. Absent -> (rarity = 'boss').
--   * cast_ms /
--     cooldown_ms   — filled with the contract defaults (4000 / 20000) only
--                     when absent or non-positive.
--   * base_amount   — promoted from the legacy `amount` mirror when missing.
--   * amount        — REMOVED, so no value has two homes.
--   * base_aoe_amount, chance, stored_power shares, accumulate.* — control
--     fields filled only when absent, with the contract defaults.
--
-- What it deliberately does NOT do:
--   * no damage, chance, cooldown, AC or crit-threshold changes;
--   * no damage_type guessing (the rows without one keep it absent; a missing
--     type is presentation-only and does not block a cast);
--   * no invented flavor prose — missing cast_flavor / hit_flavor stay missing
--     and are handled as a separate reviewed content change.
--
-- Idempotent: rerunning produces byte-identical values.

BEGIN;

-- ── Pre-flight ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_configured int;
  v_dupes int;
  v_bad_label int;
BEGIN
  SELECT count(*) INTO v_configured
  FROM public.creatures
  WHERE boss_cast IS NOT NULL AND jsonb_typeof(boss_cast) = 'object';

  RAISE NOTICE 'boss-cast backfill: % configured rows', v_configured;

  -- Every row must produce a non-empty slug from its label (or the default).
  SELECT count(*) INTO v_bad_label
  FROM public.creatures
  WHERE boss_cast IS NOT NULL
    AND jsonb_typeof(boss_cast) = 'object'
    AND trim(both '_' from regexp_replace(
          lower(coalesce(nullif(trim(boss_cast->>'label'), ''), 'Cataclysm')),
          '[^a-z0-9]+', '_', 'g')) = '';
  IF v_bad_label > 0 THEN
    RAISE EXCEPTION 'boss-cast backfill aborted: % rows derive an empty identity slug', v_bad_label;
  END IF;

  -- Proposed keys must be unique across the whole table.
  SELECT count(*) INTO v_dupes FROM (
    SELECT coalesce(
             nullif(trim(boss_cast->>'ability_key'), ''),
             trim(both '_' from regexp_replace(
               lower(coalesce(nullif(trim(boss_cast->>'label'), ''), 'Cataclysm')),
               '[^a-z0-9]+', '_', 'g'))
               || '__' || left(replace(id::text, '-', ''), 8)
           ) AS k
    FROM public.creatures
    WHERE boss_cast IS NOT NULL AND jsonb_typeof(boss_cast) = 'object'
    GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'boss-cast backfill aborted: % duplicate proposed identities', v_dupes;
  END IF;
END $$;

-- ── Backfill ──────────────────────────────────────────────────────────────────
UPDATE public.creatures c
SET boss_cast = (
  (c.boss_cast - 'amount')
  || jsonb_build_object(
       'ability_key', coalesce(
          nullif(trim(c.boss_cast->>'ability_key'), ''),
          nullif(trim(c.boss_cast->>'cast_key'), ''),
          trim(both '_' from regexp_replace(
            lower(coalesce(nullif(trim(c.boss_cast->>'label'), ''), 'Cataclysm')),
            '[^a-z0-9]+', '_', 'g'))
            || '__' || left(replace(c.id::text, '-', ''), 8)
       ),
       'label', coalesce(nullif(trim(c.boss_cast->>'label'), ''), 'Cataclysm'),
       'enabled', CASE
         WHEN jsonb_typeof(c.boss_cast->'enabled') = 'boolean'
           THEN (c.boss_cast->'enabled')
         ELSE to_jsonb(c.rarity::text = 'boss')
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
WHERE c.boss_cast IS NOT NULL
  AND jsonb_typeof(c.boss_cast) = 'object';

-- ── Post-flight ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.creatures
  WHERE boss_cast IS NOT NULL
    AND jsonb_typeof(boss_cast) = 'object'
    AND (
      nullif(trim(boss_cast->>'ability_key'), '') IS NULL
      OR jsonb_typeof(boss_cast->'enabled') <> 'boolean'
      OR coalesce((boss_cast->>'cast_ms')::numeric, 0) <= 0
      OR coalesce((boss_cast->>'cooldown_ms')::numeric, 0) <= 0
      OR jsonb_typeof(boss_cast->'chance') <> 'number'
      OR jsonb_typeof(boss_cast->'base_amount') <> 'number'
      OR boss_cast ? 'amount'
    );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'boss-cast backfill post-flight failed on % rows', v_bad;
  END IF;

  -- An enabled cast must carry usable damage; report rather than silently ship.
  SELECT count(*) INTO v_bad
  FROM public.creatures
  WHERE boss_cast IS NOT NULL
    AND (boss_cast->>'enabled')::boolean
    AND coalesce((boss_cast->>'base_amount')::numeric, 0) <= 0;
  IF v_bad > 0 THEN
    RAISE NOTICE 'boss-cast backfill: % enabled rows have no authored damage (level curve fallback applies)', v_bad;
  END IF;
END $$;

COMMIT;
