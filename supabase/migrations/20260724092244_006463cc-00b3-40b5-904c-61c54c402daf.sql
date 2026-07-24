
-- Snap existing boss_cast cast_ms and lock_ms values onto the 2000ms combat-tick grid.
-- Minimum cast_ms = 2000; lock_ms = 0 stays 0.
UPDATE public.creatures
SET boss_cast = boss_cast
  || jsonb_build_object(
    'cast_ms', GREATEST(2000, (ROUND( (COALESCE((boss_cast->>'cast_ms')::numeric, 4000)) / 2000.0 ) * 2000)::int),
    'lock_ms', (ROUND( (COALESCE((boss_cast->>'lock_ms')::numeric, 0)) / 2000.0 ) * 2000)::int
  )
WHERE boss_cast IS NOT NULL
  AND (
    (COALESCE((boss_cast->>'cast_ms')::numeric, 0)::int % 2000) <> 0
    OR (COALESCE((boss_cast->>'lock_ms')::numeric, 0)::int % 2000) <> 0
    OR COALESCE((boss_cast->>'cast_ms')::numeric, 0) < 2000
  );
