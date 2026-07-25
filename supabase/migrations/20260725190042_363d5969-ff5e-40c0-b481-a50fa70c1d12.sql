UPDATE public.creatures
SET boss_cast = jsonb_set(
  boss_cast,
  '{base_amount}',
  to_jsonb(COALESCE((boss_cast->>'amount')::int, 0)),
  true
)
WHERE rarity = 'boss'
  AND boss_cast IS NOT NULL
  AND COALESCE((boss_cast->>'amount')::int, 0) > 0
  AND COALESCE((boss_cast->>'base_amount')::int, 0) = 0;