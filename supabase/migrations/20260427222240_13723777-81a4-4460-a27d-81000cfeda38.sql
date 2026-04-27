-- Backfill missed Renown for Cithrawiel from the Master of the Silent Forge kill (rare, level 42 → 4 Renown)
UPDATE public.characters
SET bhp = bhp + 4,
    rp_total_earned = rp_total_earned + 4
WHERE id = 'a4a19757-1e72-4600-ab34-65cb0495803f';