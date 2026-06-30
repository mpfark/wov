
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
renown AS (
 SELECT c.id, COALESCE(SUM(kv.value::int),0) AS r
 FROM public.characters c
 LEFT JOIN jsonb_each_text(COALESCE(c.bhp_trained,'{}'::jsonb)) kv ON true
 GROUP BY c.id
),
calc AS (
 SELECT c.id,
  GREATEST(0,
   (48 + r.rs+r.rd+r.rc+r.ri+r.rw+r.rh + cb.cs+cb.cd+cb.cc+cb.ci+cb.cw+cb.ch
    + ((c.level-1)/3) * (cb.bs+cb.bd+cb.bc+cb.bi+cb.bw+cb.bh)
    + (c.level-1) + rn.r)
   - (c.str+c.dex+c.con+c.int+c.wis+c.cha+c.unspent_stat_points)
  ) AS missing
 FROM public.characters c
 JOIN race_b r ON r.race=c.race::text
 JOIN class_b cb ON cb.class=c.class::text
 JOIN renown rn ON rn.id=c.id
)
UPDATE public.characters c
SET unspent_stat_points = c.unspent_stat_points + calc.missing
FROM calc
WHERE calc.id = c.id AND calc.missing > 0;
