-- ============ 1. classes ============
CREATE TABLE public.classes (
  class_key text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  is_pre_class boolean NOT NULL DEFAULT false,
  is_selectable boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  base_hp integer NOT NULL DEFAULT 18,
  base_ac integer NOT NULL DEFAULT 10,
  crit_range integer NOT NULL DEFAULT 20,
  level_bonuses jsonb NOT NULL DEFAULT '{}'::jsonb,
  weapon_proficiencies text[] NOT NULL DEFAULT '{}',
  autoattack jsonb NOT NULL DEFAULT '{}'::jsonb,
  restrictions jsonb NOT NULL DEFAULT '{}'::jsonb,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classes_status_chk CHECK (status IN ('draft','active','retired')),
  CONSTRAINT classes_key_chk CHECK (class_key ~ '^[a-z][a-z0-9_]{1,31}$')
);
GRANT SELECT ON public.classes TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.classes TO authenticated;
GRANT ALL ON public.classes TO service_role;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "classes_public_read" ON public.classes FOR SELECT USING (true);
CREATE POLICY "classes_overlord_write" ON public.classes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'overlord'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'overlord'::app_role));

CREATE TRIGGER classes_updated_at BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.classes
  (class_key, label, status, is_pre_class, is_selectable, sort_order, base_hp, base_ac, crit_range, level_bonuses, weapon_proficiencies, autoattack)
VALUES
  ('classless','Wayfarer','active',true,false,0,18,10,20,'{}','{}','{}'),
  ('warrior','Warrior','active',false,true,1,24,12,20,'{"str":1,"dex":1}','{sword,axe,mace}','{"stat":"str","diceMin":1,"diceMax":10,"emoji":"⚔️","verb":"swings at","label":"Strike","selfVerb":"swing your blade at"}'),
  ('wizard','Wizard','active',false,true,2,16,9,20,'{"int":1,"wis":1}','{staff,wand}','{"stat":"int","diceMin":1,"diceMax":8,"emoji":"🔥","verb":"hurls flame at","label":"Cast Fireball","selfVerb":"hurl arcane flame at"}'),
  ('ranger','Ranger','active',false,true,3,20,10,20,'{"dex":1,"wis":1}','{bow,dagger}','{"stat":"dex","diceMin":1,"diceMax":8,"emoji":"🏹","verb":"shoots","label":"Shoot","selfVerb":"loose an arrow at"}'),
  ('assassin','Assassin','active',false,true,4,16,10,19,'{"dex":1,"cha":1}','{dagger,sword}','{"stat":"dex","diceMin":1,"diceMax":6,"emoji":"🗡️","verb":"strikes","label":"Backstab","selfVerb":"strike from the shadows at"}'),
  ('healer','Healer','active',false,true,5,18,9,20,'{"wis":1,"con":1}','{mace,staff}','{"stat":"wis","diceMin":1,"diceMax":6,"emoji":"⭐","verb":"smites","label":"Smite","selfVerb":"channel divine light against"}'),
  ('bard','Bard','active',false,true,6,16,9,20,'{"cha":1,"int":1}','{sword,wand}','{"stat":"cha","diceMin":1,"diceMax":6,"emoji":"🎵","verb":"mocks","label":"Mock","selfVerb":"unleash cutting words upon"}'),
  ('templar','Templar','active',false,true,7,22,12,20,'{"wis":1,"con":1}','{sword,mace}','{"stat":"wis","diceMin":1,"diceMax":8,"emoji":"✝️","verb":"smites with righteous steel","label":"Judgment","selfVerb":"pass divine judgment upon"}');

-- ============ 2. enum -> text ============
ALTER TABLE public.characters ALTER COLUMN class TYPE text USING class::text;
ALTER TABLE public.character_class_bonds ALTER COLUMN class TYPE text USING class::text;
ALTER TABLE public.nodes ALTER COLUMN class_hall TYPE text USING class_hall::text;

DROP FUNCTION IF EXISTS public.switch_order(uuid, character_class);
DROP FUNCTION IF EXISTS public.join_order(uuid, character_class);
DROP FUNCTION IF EXISTS public.get_order_roster(character_class);
DROP FUNCTION IF EXISTS public.award_class_bond(uuid, character_class, integer);
DROP TYPE IF EXISTS public.character_class;

ALTER TABLE public.characters
  ADD CONSTRAINT characters_class_fkey FOREIGN KEY (class) REFERENCES public.classes(class_key);
ALTER TABLE public.character_class_bonds
  ADD CONSTRAINT character_class_bonds_class_fkey FOREIGN KEY (class) REFERENCES public.classes(class_key);
ALTER TABLE public.nodes
  ADD CONSTRAINT nodes_class_hall_fkey FOREIGN KEY (class_hall) REFERENCES public.classes(class_key);

CREATE OR REPLACE FUNCTION public.award_class_bond(_character_id uuid, _class text, _amount integer)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _new integer;
BEGIN
  IF _amount IS NULL OR _amount = 0 THEN RETURN 0; END IF;
  IF _amount < 0 OR _amount > 100 THEN
    RAISE EXCEPTION 'Invalid bond delta: %', _amount;
  END IF;

  INSERT INTO public.character_class_bonds (character_id, class, bond, updated_at)
  VALUES (_character_id, _class, LEAST(100, _amount), now())
  ON CONFLICT (character_id, class)
  DO UPDATE SET bond = LEAST(100, public.character_class_bonds.bond + EXCLUDED.bond),
                updated_at = now()
  RETURNING bond INTO _new;

  RETURN _new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_order_roster(_class text)
 RETURNS TABLE(character_id uuid, name text, family_name text, level integer, class text, bond integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT c.id, c.name, c.family_name, c.level, c.class, b.bond
  FROM public.character_class_bonds b
  JOIN public.characters c ON c.id = b.character_id
  WHERE b.class = _class
    AND b.bond > 0
  ORDER BY b.bond DESC, c.level DESC, c.name ASC
  LIMIT 200
$function$;

CREATE OR REPLACE FUNCTION public.join_order(_character_id uuid, _class text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _char RECORD;
  _cls RECORD;
BEGIN
  IF NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _cls FROM public.classes WHERE class_key = _class;
  IF _cls IS NULL THEN RAISE EXCEPTION 'Unknown class: %', _class; END IF;
  IF _cls.is_pre_class OR _cls.status <> 'active' OR NOT _cls.is_selectable THEN
    RAISE EXCEPTION 'Class is not joinable: %', _class;
  END IF;

  SELECT * INTO _char FROM public.characters WHERE id = _character_id FOR UPDATE;
  IF _char IS NULL THEN RAISE EXCEPTION 'Character not found'; END IF;

  -- Leaving a class permanently erases its bond (intentional switching cost).
  DELETE FROM public.character_class_bonds
   WHERE character_id = _character_id AND class <> _class;

  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE public.characters
     SET class = _class,
         is_classless = false,
         reserved_buffs = '{}'::jsonb
   WHERE id = _character_id;

  INSERT INTO public.character_class_bonds (character_id, class, bond)
  VALUES (_character_id, _class, 0)
  ON CONFLICT (character_id, class) DO NOTHING;

  PERFORM public.sync_character_resources(_character_id);

  RETURN jsonb_build_object('class', _class, 'bond', COALESCE(
    (SELECT bond FROM public.character_class_bonds WHERE character_id = _character_id AND class = _class), 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.switch_order(_character_id uuid, _class text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.join_order(_character_id, _class);
END;
$function$;

CREATE OR REPLACE FUNCTION public.award_class_bond_for_kill(_character_id uuid, _creature_level integer, _is_boss boolean DEFAULT false)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _char RECORD;
  _gain integer;
  _new integer;
BEGIN
  SELECT id, class, is_classless INTO _char FROM public.characters WHERE id = _character_id;
  IF _char IS NULL OR _char.is_classless OR _char.class IS NULL OR _char.class = 'classless' THEN
    RETURN 0;
  END IF;

  _gain := GREATEST(1, LEAST(25,
    round(COALESCE(_creature_level, 1) * 0.5 + CASE WHEN _is_boss THEN 5 ELSE 0 END)::integer
  ));

  _new := public.award_class_bond(_character_id, _char.class, _gain);

  RETURN COALESCE(_new, 0);
END;
$function$;

-- ============ 3. ability roles / abilities / assignments / loadouts ============
CREATE TABLE public.class_ability_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_key text NOT NULL REFERENCES public.classes(class_key) ON DELETE CASCADE,
  slot integer NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  unlock_level integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT class_ability_roles_slot_chk CHECK (slot BETWEEN 1 AND 5),
  CONSTRAINT class_ability_roles_unique_slot UNIQUE (class_key, slot)
);
GRANT SELECT ON public.class_ability_roles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.class_ability_roles TO authenticated;
GRANT ALL ON public.class_ability_roles TO service_role;
ALTER TABLE public.class_ability_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles_public_read" ON public.class_ability_roles FOR SELECT USING (true);
CREATE POLICY "roles_overlord_write" ON public.class_ability_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'overlord'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'overlord'::app_role));
CREATE TRIGGER class_ability_roles_updated_at BEFORE UPDATE ON public.class_ability_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.abilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ability_key text NOT NULL UNIQUE,
  label text NOT NULL,
  emoji text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  tooltip text NOT NULL DEFAULT '',
  mechanic_key text NOT NULL,
  ability_type text NOT NULL DEFAULT 'damage',
  damage_type text,
  target_type text NOT NULL DEFAULT 'enemy',
  activation_mode text NOT NULL DEFAULT 'instant',
  cp_cost integer NOT NULL DEFAULT 0,
  cp_reserve_pct numeric,
  amount_calc jsonb,
  duration_calc jsonb,
  interval_ms integer,
  effect_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  combat_text jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abilities_key_chk CHECK (ability_key ~ '^[a-z][a-z0-9_]{1,47}$'),
  CONSTRAINT abilities_status_chk CHECK (status IN ('draft','active','retired')),
  CONSTRAINT abilities_activation_chk CHECK (activation_mode IN ('instant','queued','stance')),
  CONSTRAINT abilities_target_chk CHECK (target_type IN ('self','enemy','ally','party','node'))
);
GRANT SELECT ON public.abilities TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.abilities TO authenticated;
GRANT ALL ON public.abilities TO service_role;
ALTER TABLE public.abilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abilities_public_read" ON public.abilities FOR SELECT USING (true);
CREATE POLICY "abilities_overlord_write" ON public.abilities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'overlord'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'overlord'::app_role));
CREATE TRIGGER abilities_updated_at BEFORE UPDATE ON public.abilities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.class_ability_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_key text NOT NULL REFERENCES public.classes(class_key) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.class_ability_roles(id) ON DELETE CASCADE,
  ability_id uuid NOT NULL REFERENCES public.abilities(id) ON DELETE CASCADE,
  unlock_level integer NOT NULL DEFAULT 1,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caa_status_chk CHECK (status IN ('draft','active','retired')),
  CONSTRAINT caa_unique UNIQUE (role_id, ability_id)
);
CREATE UNIQUE INDEX caa_one_default_per_role ON public.class_ability_assignments (role_id) WHERE is_default;
GRANT SELECT ON public.class_ability_assignments TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.class_ability_assignments TO authenticated;
GRANT ALL ON public.class_ability_assignments TO service_role;
ALTER TABLE public.class_ability_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "caa_public_read" ON public.class_ability_assignments FOR SELECT USING (true);
CREATE POLICY "caa_overlord_write" ON public.class_ability_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'overlord'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'overlord'::app_role));
CREATE TRIGGER caa_updated_at BEFORE UPDATE ON public.class_ability_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.character_ability_loadout (
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.class_ability_roles(id) ON DELETE CASCADE,
  ability_id uuid NOT NULL REFERENCES public.abilities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, role_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.character_ability_loadout TO authenticated;
GRANT ALL ON public.character_ability_loadout TO service_role;
ALTER TABLE public.character_ability_loadout ENABLE ROW LEVEL SECURITY;
CREATE POLICY "loadout_owner_all" ON public.character_ability_loadout FOR ALL TO authenticated
  USING (public.owns_character(character_id) OR public.has_role(auth.uid(), 'overlord'::app_role))
  WITH CHECK (public.owns_character(character_id) OR public.has_role(auth.uid(), 'overlord'::app_role));
CREATE TRIGGER loadout_updated_at BEFORE UPDATE ON public.character_ability_loadout
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();