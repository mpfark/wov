
-- Role enum
CREATE TYPE public.app_role AS ENUM ('player', 'maiar', 'valar');

-- Race and class enums
CREATE TYPE public.character_race AS ENUM ('human', 'elf', 'dwarf', 'hobbit', 'dunedain', 'half_elf');
CREATE TYPE public.character_class AS ENUM ('warrior', 'wizard', 'ranger', 'rogue', 'healer', 'bard');
CREATE TYPE public.item_slot AS ENUM ('head', 'amulet', 'shoulders', 'chest', 'gloves', 'belt', 'pants', 'ring', 'trinket');
CREATE TYPE public.item_rarity AS ENUM ('common', 'uncommon', 'rare', 'unique');
CREATE TYPE public.creature_rarity AS ENUM ('regular', 'rare', 'boss');

-- ============ TABLES ============

-- User roles (separate from profiles per security requirements)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'player',
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Regions
CREATE TABLE public.regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  min_level INT NOT NULL DEFAULT 1,
  max_level INT NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

-- Nodes
CREATE TABLE public.nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID REFERENCES public.regions(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  connections JSONB NOT NULL DEFAULT '[]',
  searchable_items JSONB NOT NULL DEFAULT '[]',
  is_vendor BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;

-- Items
CREATE TABLE public.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  item_type TEXT NOT NULL DEFAULT 'equipment',
  slot item_slot,
  rarity item_rarity NOT NULL DEFAULT 'common',
  stats JSONB NOT NULL DEFAULT '{}',
  max_durability INT NOT NULL DEFAULT 100,
  value INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

-- Creatures
CREATE TABLE public.creatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  node_id UUID REFERENCES public.nodes(id) ON DELETE SET NULL,
  rarity creature_rarity NOT NULL DEFAULT 'regular',
  level INT NOT NULL DEFAULT 1,
  hp INT NOT NULL DEFAULT 10,
  max_hp INT NOT NULL DEFAULT 10,
  stats JSONB NOT NULL DEFAULT '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}',
  ac INT NOT NULL DEFAULT 10,
  is_aggressive BOOLEAN NOT NULL DEFAULT false,
  loot_table JSONB NOT NULL DEFAULT '[]',
  respawn_seconds INT NOT NULL DEFAULT 300,
  is_alive BOOLEAN NOT NULL DEFAULT true,
  died_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.creatures ENABLE ROW LEVEL SECURITY;

-- Characters
CREATE TABLE public.characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  race character_race NOT NULL,
  class character_class NOT NULL,
  level INT NOT NULL DEFAULT 1,
  xp INT NOT NULL DEFAULT 0,
  hp INT NOT NULL DEFAULT 20,
  max_hp INT NOT NULL DEFAULT 20,
  gold INT NOT NULL DEFAULT 10,
  str INT NOT NULL DEFAULT 10,
  dex INT NOT NULL DEFAULT 10,
  con INT NOT NULL DEFAULT 10,
  int INT NOT NULL DEFAULT 10,
  wis INT NOT NULL DEFAULT 10,
  cha INT NOT NULL DEFAULT 10,
  ac INT NOT NULL DEFAULT 10,
  current_node_id UUID REFERENCES public.nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

-- Character inventory
CREATE TABLE public.character_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID REFERENCES public.characters(id) ON DELETE CASCADE NOT NULL,
  item_id UUID REFERENCES public.items(id) ON DELETE CASCADE NOT NULL,
  equipped_slot item_slot,
  current_durability INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.character_inventory ENABLE ROW LEVEL SECURITY;

-- ============ HELPER FUNCTIONS ============

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_valar()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'valar')
$$;

CREATE OR REPLACE FUNCTION public.is_maiar_or_valar()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'maiar') OR public.has_role(auth.uid(), 'valar')
$$;

CREATE OR REPLACE FUNCTION public.owns_character(_character_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.characters
    WHERE id = _character_id AND user_id = auth.uid()
  )
$$;

-- Auto-create profile and player role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'player');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_characters_updated_at BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============ RLS POLICIES ============

-- user_roles
CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_maiar_or_valar());
CREATE POLICY "Valar can insert roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_valar());
CREATE POLICY "Valar can update roles" ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_valar());
CREATE POLICY "Valar can delete roles" ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_valar());

-- profiles
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_maiar_or_valar());
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- regions (readable by all authenticated)
CREATE POLICY "Anyone can view regions" ON public.regions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert regions" ON public.regions FOR INSERT TO authenticated WITH CHECK (public.is_maiar_or_valar());
CREATE POLICY "Admins can update regions" ON public.regions FOR UPDATE TO authenticated USING (public.is_maiar_or_valar());
CREATE POLICY "Admins can delete regions" ON public.regions FOR DELETE TO authenticated USING (public.is_maiar_or_valar());

-- nodes
CREATE POLICY "Anyone can view nodes" ON public.nodes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert nodes" ON public.nodes FOR INSERT TO authenticated WITH CHECK (public.is_maiar_or_valar());
CREATE POLICY "Admins can update nodes" ON public.nodes FOR UPDATE TO authenticated USING (public.is_maiar_or_valar());
CREATE POLICY "Admins can delete nodes" ON public.nodes FOR DELETE TO authenticated USING (public.is_maiar_or_valar());

-- items
CREATE POLICY "Anyone can view items" ON public.items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert items" ON public.items FOR INSERT TO authenticated WITH CHECK (public.is_maiar_or_valar());
CREATE POLICY "Admins can update items" ON public.items FOR UPDATE TO authenticated USING (public.is_maiar_or_valar());
CREATE POLICY "Admins can delete items" ON public.items FOR DELETE TO authenticated USING (public.is_maiar_or_valar());

-- creatures
CREATE POLICY "Anyone can view creatures" ON public.creatures FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert creatures" ON public.creatures FOR INSERT TO authenticated WITH CHECK (public.is_maiar_or_valar());
CREATE POLICY "Admins can update creatures" ON public.creatures FOR UPDATE TO authenticated USING (public.is_maiar_or_valar());
CREATE POLICY "Admins can delete creatures" ON public.creatures FOR DELETE TO authenticated USING (public.is_maiar_or_valar());

-- characters
CREATE POLICY "Users can view own characters" ON public.characters FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_maiar_or_valar());
CREATE POLICY "Users can create characters" ON public.characters FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own characters" ON public.characters FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own characters" ON public.characters FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- character_inventory
CREATE POLICY "Owners can view inventory" ON public.character_inventory FOR SELECT TO authenticated
  USING (public.owns_character(character_id) OR public.is_maiar_or_valar());
CREATE POLICY "Owners can insert inventory" ON public.character_inventory FOR INSERT TO authenticated
  WITH CHECK (public.owns_character(character_id));
CREATE POLICY "Owners can update inventory" ON public.character_inventory FOR UPDATE TO authenticated
  USING (public.owns_character(character_id));
CREATE POLICY "Owners can delete inventory" ON public.character_inventory FOR DELETE TO authenticated
  USING (public.owns_character(character_id));

-- Enable realtime for characters (presence tracking)
ALTER PUBLICATION supabase_realtime ADD TABLE public.characters;
