
DO $$
DECLARE
  ch RECORD;
  r_str INT; r_dex INT; r_con INT; r_int INT; r_wis INT; r_cha INT;
  c_str INT; c_dex INT; c_con INT; c_int INT; c_wis INT; c_cha INT;
  new_str INT; new_dex INT; new_con INT; new_int INT; new_wis INT; new_cha INT;
  lvl_bonus_count INT;
  lb1 TEXT; lb2 TEXT;
  new_max_hp INT; new_ac INT; new_max_cp INT; new_max_mp INT;
  con_mod INT; dex_mod INT; int_mod INT; wis_mod INT; cha_mod INT; mental_mod INT;
  base_hp INT; base_ac INT;
BEGIN
  FOR ch IN SELECT * FROM public.characters LOOP

    CASE ch.race::text
      WHEN 'human'    THEN r_str:=1; r_dex:=1; r_con:=1; r_int:=1; r_wis:=1; r_cha:=1;
      WHEN 'elf'      THEN r_str:=-1; r_dex:=2; r_con:=-1; r_int:=2; r_wis:=3; r_cha:=0;
      WHEN 'dwarf'    THEN r_str:=2; r_dex:=-1; r_con:=4; r_int:=0; r_wis:=1; r_cha:=-2;
      WHEN 'halfling' THEN r_str:=-2; r_dex:=3; r_con:=1; r_int:=0; r_wis:=1; r_cha:=2;
      WHEN 'edain'    THEN r_str:=1; r_dex:=0; r_con:=3; r_int:=1; r_wis:=1; r_cha:=1;
      WHEN 'half_elf' THEN r_str:=0; r_dex:=1; r_con:=0; r_int:=1; r_wis:=2; r_cha:=3;
      ELSE r_str:=0; r_dex:=0; r_con:=0; r_int:=0; r_wis:=0; r_cha:=0;
    END CASE;

    CASE ch.class::text
      WHEN 'warrior' THEN c_str:=3; c_dex:=1; c_con:=2; c_int:=0; c_wis:=0; c_cha:=0;
      WHEN 'wizard'  THEN c_str:=0; c_dex:=0; c_con:=0; c_int:=3; c_wis:=2; c_cha:=1;
      WHEN 'ranger'  THEN c_str:=1; c_dex:=3; c_con:=1; c_int:=0; c_wis:=2; c_cha:=0;
      WHEN 'rogue'   THEN c_str:=0; c_dex:=3; c_con:=0; c_int:=1; c_wis:=0; c_cha:=2;
      WHEN 'healer'  THEN c_str:=0; c_dex:=0; c_con:=1; c_int:=1; c_wis:=3; c_cha:=2;
      WHEN 'bard'    THEN c_str:=0; c_dex:=1; c_con:=0; c_int:=1; c_wis:=1; c_cha:=3;
      ELSE c_str:=0; c_dex:=0; c_con:=0; c_int:=0; c_wis:=0; c_cha:=0;
    END CASE;

    new_str := 8 + r_str + c_str;
    new_dex := 8 + r_dex + c_dex;
    new_con := 8 + r_con + c_con;
    new_int := 8 + r_int + c_int;
    new_wis := 8 + r_wis + c_wis;
    new_cha := 8 + r_cha + c_cha;

    -- Class level bonuses every 3 levels
    lvl_bonus_count := FLOOR((ch.level - 1)::numeric / 3);
    CASE ch.class::text
      WHEN 'warrior' THEN lb1:='str'; lb2:='dex';
      WHEN 'wizard'  THEN lb1:='int'; lb2:='wis';
      WHEN 'ranger'  THEN lb1:='dex'; lb2:='wis';
      WHEN 'rogue'   THEN lb1:='dex'; lb2:='cha';
      WHEN 'healer'  THEN lb1:='wis'; lb2:='con';
      WHEN 'bard'    THEN lb1:='cha'; lb2:='int';
      ELSE lb1:='str'; lb2:='str';
    END CASE;

    IF lb1='str' THEN new_str:=new_str+lvl_bonus_count; END IF;
    IF lb1='dex' THEN new_dex:=new_dex+lvl_bonus_count; END IF;
    IF lb1='con' THEN new_con:=new_con+lvl_bonus_count; END IF;
    IF lb1='int' THEN new_int:=new_int+lvl_bonus_count; END IF;
    IF lb1='wis' THEN new_wis:=new_wis+lvl_bonus_count; END IF;
    IF lb1='cha' THEN new_cha:=new_cha+lvl_bonus_count; END IF;
    IF lb2='str' THEN new_str:=new_str+lvl_bonus_count; END IF;
    IF lb2='dex' THEN new_dex:=new_dex+lvl_bonus_count; END IF;
    IF lb2='con' THEN new_con:=new_con+lvl_bonus_count; END IF;
    IF lb2='int' THEN new_int:=new_int+lvl_bonus_count; END IF;
    IF lb2='wis' THEN new_wis:=new_wis+lvl_bonus_count; END IF;
    IF lb2='cha' THEN new_cha:=new_cha+lvl_bonus_count; END IF;

    -- Derived stats
    CASE ch.class::text
      WHEN 'warrior' THEN base_hp:=24; base_ac:=14;
      WHEN 'ranger'  THEN base_hp:=20; base_ac:=12;
      WHEN 'healer'  THEN base_hp:=18; base_ac:=11;
      WHEN 'wizard'  THEN base_hp:=16; base_ac:=11;
      WHEN 'rogue'   THEN base_hp:=16; base_ac:=12;
      WHEN 'bard'    THEN base_hp:=16; base_ac:=11;
      ELSE base_hp:=18; base_ac:=10;
    END CASE;

    con_mod := FLOOR((new_con - 10)::numeric / 2);
    dex_mod := FLOOR((new_dex - 10)::numeric / 2);
    int_mod := FLOOR((new_int - 10)::numeric / 2);
    wis_mod := FLOOR((new_wis - 10)::numeric / 2);
    cha_mod := FLOOR((new_cha - 10)::numeric / 2);

    new_max_hp := base_hp + con_mod + (ch.level - 1) * 5;
    new_ac := base_ac + dex_mod;
    mental_mod := GREATEST(int_mod, wis_mod, cha_mod, 0);
    new_max_cp := 60 + (ch.level - 1) * 3 + mental_mod * 5;
    new_max_mp := 100 + GREATEST(dex_mod, 0) * 10 + FLOOR((ch.level - 1)::numeric * 2);

    UPDATE public.characters SET
      str = new_str, dex = new_dex, con = new_con,
      int = new_int, wis = new_wis, cha = new_cha,
      max_hp = new_max_hp, hp = LEAST(ch.hp, new_max_hp),
      ac = new_ac,
      max_cp = new_max_cp, cp = LEAST(ch.cp, new_max_cp),
      max_mp = new_max_mp, mp = LEAST(ch.mp, new_max_mp),
      unspent_stat_points = ch.level - 1
    WHERE id = ch.id;

  END LOOP;
END $$;
