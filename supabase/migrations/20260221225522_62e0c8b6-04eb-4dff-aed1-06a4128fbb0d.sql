
-- Apply race stat deltas (new - old bonuses) to existing characters
-- Then recalculate max_hp, ac, max_cp

-- Step 1: Apply stat deltas per race
UPDATE characters SET
  str = str + CASE race
    WHEN 'elf' THEN -1 WHEN 'halfling' THEN -1 ELSE 0 END,
  dex = dex + CASE race
    WHEN 'dwarf' THEN -1 WHEN 'halfling' THEN 1 ELSE 0 END,
  con = con + CASE race
    WHEN 'elf' THEN -1 WHEN 'dwarf' THEN 2 WHEN 'edain' THEN 1 ELSE 0 END,
  int = int + CASE race
    WHEN 'elf' THEN 1 ELSE 0 END,
  wis = wis + CASE race
    WHEN 'elf' THEN 2 WHEN 'half_elf' THEN 1 ELSE 0 END,
  cha = cha + CASE race
    WHEN 'dwarf' THEN -1 WHEN 'halfling' THEN 1 WHEN 'half_elf' THEN 1 ELSE 0 END;

-- Step 2: Recalculate max_hp = CLASS_BASE_HP + floor((con-10)/2) + (level-1)*5
-- Also set hp to max_hp (full heal on respec)
UPDATE characters SET
  max_hp = (
    CASE class
      WHEN 'warrior' THEN 24 WHEN 'wizard' THEN 16 WHEN 'ranger' THEN 20
      WHEN 'rogue' THEN 16 WHEN 'healer' THEN 18 WHEN 'bard' THEN 16
    END
  ) + FLOOR((con - 10)::numeric / 2) + (level - 1) * 5,
  hp = LEAST(hp, (
    CASE class
      WHEN 'warrior' THEN 24 WHEN 'wizard' THEN 16 WHEN 'ranger' THEN 20
      WHEN 'rogue' THEN 16 WHEN 'healer' THEN 18 WHEN 'bard' THEN 16
    END
  ) + FLOOR((con - 10)::numeric / 2) + (level - 1) * 5);

-- Step 3: Recalculate AC = CLASS_BASE_AC + floor((dex-10)/2)
UPDATE characters SET
  ac = (
    CASE class
      WHEN 'warrior' THEN 14 WHEN 'wizard' THEN 11 WHEN 'ranger' THEN 12
      WHEN 'rogue' THEN 12 WHEN 'healer' THEN 11 WHEN 'bard' THEN 11
    END
  ) + FLOOR((dex - 10)::numeric / 2);

-- Step 4: Recalculate max_cp = 60 + (level-1)*3 + mentalMod*5
-- mentalMod = GREATEST(floor((int-10)/2), floor((wis-10)/2), floor((cha-10)/2), 0)
UPDATE characters SET
  max_cp = 60 + (level - 1) * 3 + GREATEST(
    FLOOR((int - 10)::numeric / 2),
    FLOOR((wis - 10)::numeric / 2),
    FLOOR((cha - 10)::numeric / 2),
    0
  ) * 5,
  cp = LEAST(cp, 60 + (level - 1) * 3 + GREATEST(
    FLOOR((int - 10)::numeric / 2),
    FLOOR((wis - 10)::numeric / 2),
    FLOOR((cha - 10)::numeric / 2),
    0
  ) * 5);
