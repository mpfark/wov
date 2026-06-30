
-- Fix stat point over-grant from the 20260630083258 backfill.
-- Characters are created as 'classless' (no class stat bonus). The earlier
-- backfill assumed the class stat bonus was applied at creation and granted
-- extra unspent points equal to the class-stat sum.
--
-- Correct budget = 48 (6*8 base) + race_sum + (level-1) level-up points
--                + (level-1)/3 * class_level_bonus_sum
-- Overage = (current_stat_sum + unspent) - correct_budget
-- Reduce unspent by min(unspent, overage). Never reduce below 0.
-- Never touch already-allocated stats.
WITH race_b(race,rs,rd,rc,ri,rw,rh) AS (VALUES
 ('human',1,1,1,1,1,1),('elf',-1,2,-1,2,3,0),('dwarf',2,-1,4,0,1,-2),
 ('halfling',-2,3,1,0,1,2),('edain',1,0,3,1,1,1),('half_elf',0,1,0,1,2,3)),
class_lvl(class,bs,bd,bc,bi,bw,bh) AS (VALUES
 ('warrior',1,1,0,0,0,0),
 ('wizard',0,0,0,1,1,0),
 ('ranger',0,1,0,0,1,0),
 ('assassin',0,1,0,0,0,1),
 ('healer',0,0,1,0,1,0),
 ('bard',0,0,0,1,0,1),
 ('templar',0,0,1,0,1,0),
 ('classless',0,0,0,0,0,0)),
calc AS (
  SELECT c.id,
    (c.str+c.dex+c.con+c.int+c.wis+c.cha+c.unspent_stat_points)
    -
    (48 + r.rs+r.rd+r.rc+r.ri+r.rw+r.rh
     + (c.level-1)
     + ((c.level-1)/3) * (cl.bs+cl.bd+cl.bc+cl.bi+cl.bw+cl.bh))
    AS overage,
    c.unspent_stat_points AS unspent
  FROM characters c
  JOIN race_b r ON r.race = c.race::text
  JOIN class_lvl cl ON cl.class = c.class::text
)
UPDATE characters c
SET unspent_stat_points = c.unspent_stat_points - LEAST(calc.unspent, calc.overage)
FROM calc
WHERE calc.id = c.id AND calc.overage > 0 AND calc.unspent > 0;
