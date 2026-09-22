-- Reconcile persisted maximum CP with the authoritative INT+WIS formula.
-- This migration is forward-only and deliberately does not grant current CP.

CREATE OR REPLACE FUNCTION public.sync_character_resources(p_character_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.characters%ROWTYPE;
  bonus_hp integer := 0; bonus_con integer := 0; bonus_int integer := 0;
  bonus_wis integer := 0; bonus_dex integer := 0;
  con_mod integer; int_mod integer; wis_mod integer; dex_mod integer;
  new_max_hp integer; new_max_cp integer; new_max_mp integer;
  new_hp integer; new_cp integer; new_mp integer; base_hp integer;
BEGIN
  IF NOT public.owns_character(p_character_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO c FROM public.characters WHERE id=p_character_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Character not found'; END IF;

  WITH equipped AS (
    SELECT COALESCE(NULLIF(ci.stat_override,'{}'::jsonb),i.stats,'{}'::jsonb) base,
           COALESCE(ci.applied_gems,'{}'::jsonb) gems
    FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
    WHERE ci.character_id=p_character_id AND ci.equipped_slot IS NOT NULL AND ci.current_durability>0
  ) SELECT
    COALESCE(sum(COALESCE((base->>'hp')::int,0)),0),
    COALESCE(sum(COALESCE((base->>'con')::int,0)+COALESCE((gems->>'emerald')::int,0)),0),
    COALESCE(sum(COALESCE((base->>'int')::int,0)+COALESCE((gems->>'sapphire')::int,0)),0),
    COALESCE(sum(COALESCE((base->>'wis')::int,0)+COALESCE((gems->>'pearl')::int,0)),0),
    COALESCE(sum(COALESCE((base->>'dex')::int,0)+COALESCE((gems->>'topaz')::int,0)),0)
  INTO bonus_hp,bonus_con,bonus_int,bonus_wis,bonus_dex FROM equipped;

  base_hp := CASE c.class::text WHEN 'warrior' THEN 24 WHEN 'wizard' THEN 16
    WHEN 'ranger' THEN 20 WHEN 'rogue' THEN 16 WHEN 'assassin' THEN 16
    WHEN 'healer' THEN 18 WHEN 'bard' THEN 16 WHEN 'templar' THEN 22 ELSE 18 END;
  con_mod := floor(((c.con+bonus_con)-10)/2.0)::int;
  int_mod := greatest(floor(((c.int+bonus_int)-10)/2.0)::int,0);
  wis_mod := greatest(floor(((c.wis+bonus_wis)-10)/2.0)::int,0);
  dex_mod := greatest(floor(((c.dex+bonus_dex)-10)/2.0)::int,0);
  new_max_hp := least(greatest(base_hp+con_mod*2+(c.level-1)*5+bonus_hp,1),10000);
  new_max_cp := least(greatest(30+(c.level-1)*3+(int_mod+wis_mod)*3,0),5000);
  new_max_mp := least(greatest(100+dex_mod*10+floor((c.level-1)*2)::int,0),5000);
  new_hp := least(greatest(c.hp,0),new_max_hp);
  new_cp := least(greatest(COALESCE(c.cp,0),0),new_max_cp);
  new_mp := least(greatest(COALESCE(c.mp,0),0),new_max_mp);
  PERFORM set_config('app.trusted_rpc','true',true);
  UPDATE public.characters SET max_hp=new_max_hp,max_cp=new_max_cp,max_mp=new_max_mp,
    hp=new_hp,cp=new_cp,mp=new_mp WHERE id=p_character_id;
  RETURN jsonb_build_object('max_hp',new_max_hp,'max_cp',new_max_cp,'max_mp',new_max_mp,
    'hp',new_hp,'cp',new_cp,'mp',new_mp);
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_character_resources(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_character_resources(uuid) TO authenticated, service_role;

DO $migration$
BEGIN
  PERFORM set_config('app.trusted_rpc','true',true);
  WITH equipment AS (
    SELECT c.id,
      COALESCE(sum(COALESCE((COALESCE(NULLIF(ci.stat_override,'{}'::jsonb),i.stats,'{}'::jsonb)->>'int')::int,0)
        +COALESCE((COALESCE(ci.applied_gems,'{}'::jsonb)->>'sapphire')::int,0)),0)::int bonus_int,
      COALESCE(sum(COALESCE((COALESCE(NULLIF(ci.stat_override,'{}'::jsonb),i.stats,'{}'::jsonb)->>'wis')::int,0)
        +COALESCE((COALESCE(ci.applied_gems,'{}'::jsonb)->>'pearl')::int,0)),0)::int bonus_wis
    FROM public.characters c
    LEFT JOIN public.character_inventory ci ON ci.character_id=c.id
      AND ci.equipped_slot IS NOT NULL AND ci.current_durability>0
    LEFT JOIN public.items i ON i.id=ci.item_id GROUP BY c.id
  ), calculated AS (
    SELECT c.id, least(greatest(30+(c.level-1)*3+
      (greatest(floor(((c.int+e.bonus_int)-10)/2.0)::int,0)
       +greatest(floor(((c.wis+e.bonus_wis)-10)/2.0)::int,0))*3,0),5000)::int new_max_cp
    FROM public.characters c JOIN equipment e ON e.id=c.id
  )
  UPDATE public.characters c SET max_cp=x.new_max_cp,
    cp=least(greatest(COALESCE(c.cp,0),0),x.new_max_cp)
  FROM calculated x WHERE x.id=c.id
    AND (c.max_cp IS DISTINCT FROM x.new_max_cp OR c.cp IS DISTINCT FROM least(greatest(COALESCE(c.cp,0),0),x.new_max_cp));
END;
$migration$;