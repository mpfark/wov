
-- Backfill missing per-level stat points (level - 1 points expected total)
WITH race_b(race,rs,rd,rc,ri,rw,rh) AS (VALUES
 ('human',1,1,1,1,1,1),('elf',-1,2,-1,2,3,0),('dwarf',2,-1,4,0,1,-2),
 ('halfling',-2,3,1,0,1,2),('edain',1,0,3,1,1,1),('half_elf',0,1,0,1,2,3)),
class_b(class,cs,cd,cc,ci,cw,ch,bs,bd,bc,bi,bw,bh) AS (VALUES
 ('warrior',3,1,2,0,0,0,1,1,0,0,0,0),
 ('wizard',0,0,0,3,2,1,0,0,0,1,1,0),
 ('ranger',1,3,1,0,2,0,0,1,0,0,1,0),
 ('assassin',0,3,0,1,0,2,0,1,0,0,0,1),
 ('healer',0,0,1,1,3,2,0,0,1,0,1,0),
 ('bard',0,1,0,1,1,3,0,0,0,1,0,1),
 ('templar',1,1,2,0,3,0,0,0,1,0,1,0),
 ('classless',0,0,0,0,0,0,0,0,0,0,0,0)),
calc AS (
  SELECT c.id,
    GREATEST(0,
      (48 + r.rs+r.rd+r.rc+r.ri+r.rw+r.rh + cb.cs+cb.cd+cb.cc+cb.ci+cb.cw+cb.ch
       + ((c.level-1)/3) * (cb.bs+cb.bd+cb.bc+cb.bi+cb.bw+cb.bh)
       + (c.level-1))
      - (c.str+c.dex+c.con+c.int+c.wis+c.cha+c.unspent_stat_points)
    ) AS missing
  FROM characters c
  JOIN race_b r ON r.race = c.race::text
  JOIN class_b cb ON cb.class = c.class::text
)
UPDATE characters c
SET unspent_stat_points = c.unspent_stat_points + calc.missing
FROM calc
WHERE calc.id = c.id AND calc.missing > 0;
