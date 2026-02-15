
-- 1. Rename enum values
ALTER TYPE public.app_role RENAME VALUE 'valar' TO 'overlord';
ALTER TYPE public.app_role RENAME VALUE 'maiar' TO 'steward';
ALTER TYPE public.character_race RENAME VALUE 'hobbit' TO 'halfling';
ALTER TYPE public.character_race RENAME VALUE 'dunedain' TO 'edain';

-- 2. Replace is_valar() with is_overlord()
CREATE OR REPLACE FUNCTION public.is_overlord()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'overlord')
$$;

-- 3. Replace is_maiar_or_valar() with is_steward_or_overlord()
CREATE OR REPLACE FUNCTION public.is_steward_or_overlord()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'steward') OR public.has_role(auth.uid(), 'overlord')
$$;

-- 4. Drop all RLS policies that reference old functions, then recreate with new names

-- activity_log
DROP POLICY IF EXISTS "Admins can insert activity logs" ON public.activity_log;
DROP POLICY IF EXISTS "Admins can view activity logs" ON public.activity_log;
CREATE POLICY "Admins can insert activity logs" ON public.activity_log FOR INSERT WITH CHECK (is_steward_or_overlord());
CREATE POLICY "Admins can view activity logs" ON public.activity_log FOR SELECT USING (is_steward_or_overlord());

-- character_inventory
DROP POLICY IF EXISTS "Owners can view inventory" ON public.character_inventory;
CREATE POLICY "Owners can view inventory" ON public.character_inventory FOR SELECT USING (owns_character(character_id) OR is_steward_or_overlord());

-- characters
DROP POLICY IF EXISTS "Users can view own or party characters" ON public.characters;
CREATE POLICY "Users can view own or party characters" ON public.characters FOR SELECT USING (auth.uid() = user_id OR is_steward_or_overlord() OR is_party_mate(id));

-- class_starting_gear
DROP POLICY IF EXISTS "Admins can delete starting gear" ON public.class_starting_gear;
DROP POLICY IF EXISTS "Admins can insert starting gear" ON public.class_starting_gear;
DROP POLICY IF EXISTS "Admins can update starting gear" ON public.class_starting_gear;
CREATE POLICY "Admins can delete starting gear" ON public.class_starting_gear FOR DELETE USING (is_steward_or_overlord());
CREATE POLICY "Admins can insert starting gear" ON public.class_starting_gear FOR INSERT WITH CHECK (is_steward_or_overlord());
CREATE POLICY "Admins can update starting gear" ON public.class_starting_gear FOR UPDATE USING (is_steward_or_overlord());

-- creatures
DROP POLICY IF EXISTS "Admins can delete creatures" ON public.creatures;
DROP POLICY IF EXISTS "Admins can insert creatures" ON public.creatures;
DROP POLICY IF EXISTS "Admins can update creatures" ON public.creatures;
CREATE POLICY "Admins can delete creatures" ON public.creatures FOR DELETE USING (is_steward_or_overlord());
CREATE POLICY "Admins can insert creatures" ON public.creatures FOR INSERT WITH CHECK (is_steward_or_overlord());
CREATE POLICY "Admins can update creatures" ON public.creatures FOR UPDATE USING (is_steward_or_overlord());

-- items
DROP POLICY IF EXISTS "Admins can delete items" ON public.items;
DROP POLICY IF EXISTS "Admins can insert items" ON public.items;
DROP POLICY IF EXISTS "Admins can update items" ON public.items;
CREATE POLICY "Admins can delete items" ON public.items FOR DELETE USING (is_steward_or_overlord());
CREATE POLICY "Admins can insert items" ON public.items FOR INSERT WITH CHECK (is_steward_or_overlord());
CREATE POLICY "Admins can update items" ON public.items FOR UPDATE USING (is_steward_or_overlord());

-- nodes
DROP POLICY IF EXISTS "Admins can delete nodes" ON public.nodes;
DROP POLICY IF EXISTS "Admins can insert nodes" ON public.nodes;
DROP POLICY IF EXISTS "Admins can update nodes" ON public.nodes;
CREATE POLICY "Admins can delete nodes" ON public.nodes FOR DELETE USING (is_steward_or_overlord());
CREATE POLICY "Admins can insert nodes" ON public.nodes FOR INSERT WITH CHECK (is_steward_or_overlord());
CREATE POLICY "Admins can update nodes" ON public.nodes FOR UPDATE USING (is_steward_or_overlord());

-- npcs
DROP POLICY IF EXISTS "Admins can delete npcs" ON public.npcs;
DROP POLICY IF EXISTS "Admins can insert npcs" ON public.npcs;
DROP POLICY IF EXISTS "Admins can update npcs" ON public.npcs;
CREATE POLICY "Admins can delete npcs" ON public.npcs FOR DELETE USING (is_steward_or_overlord());
CREATE POLICY "Admins can insert npcs" ON public.npcs FOR INSERT WITH CHECK (is_steward_or_overlord());
CREATE POLICY "Admins can update npcs" ON public.npcs FOR UPDATE USING (is_steward_or_overlord());

-- regions
DROP POLICY IF EXISTS "Admins can delete regions" ON public.regions;
DROP POLICY IF EXISTS "Admins can insert regions" ON public.regions;
DROP POLICY IF EXISTS "Admins can update regions" ON public.regions;
CREATE POLICY "Admins can delete regions" ON public.regions FOR DELETE USING (is_steward_or_overlord());
CREATE POLICY "Admins can insert regions" ON public.regions FOR INSERT WITH CHECK (is_steward_or_overlord());
CREATE POLICY "Admins can update regions" ON public.regions FOR UPDATE USING (is_steward_or_overlord());

-- roadmap_items
DROP POLICY IF EXISTS "Admins can delete roadmap items" ON public.roadmap_items;
DROP POLICY IF EXISTS "Admins can insert roadmap items" ON public.roadmap_items;
DROP POLICY IF EXISTS "Admins can update roadmap items" ON public.roadmap_items;
CREATE POLICY "Admins can delete roadmap items" ON public.roadmap_items FOR DELETE USING (is_steward_or_overlord());
CREATE POLICY "Admins can insert roadmap items" ON public.roadmap_items FOR INSERT WITH CHECK (is_steward_or_overlord());
CREATE POLICY "Admins can update roadmap items" ON public.roadmap_items FOR UPDATE USING (is_steward_or_overlord());

-- profiles
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id OR is_steward_or_overlord());

-- user_roles
DROP POLICY IF EXISTS "Valar can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Valar can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Valar can update roles" ON public.user_roles;
CREATE POLICY "Overlords can delete roles" ON public.user_roles FOR DELETE USING (is_overlord());
CREATE POLICY "Overlords can insert roles" ON public.user_roles FOR INSERT WITH CHECK (is_overlord());
CREATE POLICY "Overlords can update roles" ON public.user_roles FOR UPDATE USING (is_overlord());

-- vendor_inventory
DROP POLICY IF EXISTS "Admins can manage vendor inventory" ON public.vendor_inventory;
CREATE POLICY "Admins can manage vendor inventory" ON public.vendor_inventory FOR ALL USING (is_steward_or_overlord());

-- 5. Drop old functions (keep backwards compat until code is updated, but let's clean up)
DROP FUNCTION IF EXISTS public.is_valar();
DROP FUNCTION IF EXISTS public.is_maiar_or_valar();
