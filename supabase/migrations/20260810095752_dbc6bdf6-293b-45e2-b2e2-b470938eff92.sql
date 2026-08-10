UPDATE public.abilities a
SET amount_calc = COALESCE(a.amount_calc, b.amount_calc),
    duration_calc = COALESCE(a.duration_calc, b.duration_calc),
    interval_ms = COALESCE(a.interval_ms, b.interval_ms),
    mechanic_calcs = CASE
      WHEN a.mechanic_calcs IS NULL OR a.mechanic_calcs = '{}'::jsonb
        THEN COALESCE(b.mechanic_calcs, '{}'::jsonb)
      ELSE a.mechanic_calcs END,
    updated_at = now()
FROM public.base_abilities b
WHERE a.base_ability_id = b.id
  AND a.status = 'draft'
  AND (a.amount_calc IS NULL OR a.duration_calc IS NULL OR a.interval_ms IS NULL);