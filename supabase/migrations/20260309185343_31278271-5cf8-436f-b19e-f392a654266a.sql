-- Recalculate max_hp for all characters using the correct formula:
-- max_hp = CLASS_BASE_HP + floor((CON - 10) / 2) + (level - 1) * 5
-- This fixes characters whose max_hp was incorrectly calculated due to:
-- 1. Admin set-level using wrong race stats/base HP
-- 2. Level-ups not accounting for CON changes from class bonuses

UPDATE characters SET max_hp = 
  CASE class
    WHEN 'warrior' THEN 24
    WHEN 'wizard' THEN 16
    WHEN 'ranger' THEN 20
    WHEN 'rogue' THEN 16
    WHEN 'healer' THEN 18
    WHEN 'bard' THEN 16
    ELSE 18
  END
  + FLOOR((con - 10)::numeric / 2)
  + (level - 1) * 5;

-- Also set hp to max_hp where hp exceeds new max_hp
UPDATE characters SET hp = max_hp WHERE hp > max_hp;