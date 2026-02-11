
-- Drop restrictive SELECT policies on world tables and recreate as PERMISSIVE
DROP POLICY "Anyone can view regions" ON public.regions;
CREATE POLICY "Anyone can view regions" ON public.regions FOR SELECT TO authenticated USING (true);

DROP POLICY "Anyone can view nodes" ON public.nodes;
CREATE POLICY "Anyone can view nodes" ON public.nodes FOR SELECT TO authenticated USING (true);

DROP POLICY "Anyone can view creatures" ON public.creatures;
CREATE POLICY "Anyone can view creatures" ON public.creatures FOR SELECT TO authenticated USING (true);

DROP POLICY "Anyone can view items" ON public.items;
CREATE POLICY "Anyone can view items" ON public.items FOR SELECT TO authenticated USING (true);

-- Fix character policies too
DROP POLICY "Users can view own characters" ON public.characters;
CREATE POLICY "Users can view own characters" ON public.characters FOR SELECT TO authenticated 
  USING (auth.uid() = user_id OR is_maiar_or_valar());

DROP POLICY "Users can create characters" ON public.characters;
CREATE POLICY "Users can create characters" ON public.characters FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() = user_id);

DROP POLICY "Users can update own characters" ON public.characters;
CREATE POLICY "Users can update own characters" ON public.characters FOR UPDATE TO authenticated 
  USING (auth.uid() = user_id);

DROP POLICY "Users can delete own characters" ON public.characters;
CREATE POLICY "Users can delete own characters" ON public.characters FOR DELETE TO authenticated 
  USING (auth.uid() = user_id);

-- Fix user_roles
DROP POLICY "Users can view own role" ON public.user_roles;
CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT TO authenticated 
  USING (auth.uid() = user_id OR is_maiar_or_valar());

DROP POLICY "Valar can insert roles" ON public.user_roles;
CREATE POLICY "Valar can insert roles" ON public.user_roles FOR INSERT TO authenticated 
  WITH CHECK (is_valar());

DROP POLICY "Valar can update roles" ON public.user_roles;
CREATE POLICY "Valar can update roles" ON public.user_roles FOR UPDATE TO authenticated 
  USING (is_valar());

DROP POLICY "Valar can delete roles" ON public.user_roles;
CREATE POLICY "Valar can delete roles" ON public.user_roles FOR DELETE TO authenticated 
  USING (is_valar());

-- Fix profiles
DROP POLICY "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated 
  USING (auth.uid() = user_id OR is_maiar_or_valar());

DROP POLICY "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() = user_id);

DROP POLICY "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated 
  USING (auth.uid() = user_id);

-- Fix inventory
DROP POLICY "Owners can view inventory" ON public.character_inventory;
CREATE POLICY "Owners can view inventory" ON public.character_inventory FOR SELECT TO authenticated 
  USING (owns_character(character_id) OR is_maiar_or_valar());

DROP POLICY "Owners can insert inventory" ON public.character_inventory;
CREATE POLICY "Owners can insert inventory" ON public.character_inventory FOR INSERT TO authenticated 
  WITH CHECK (owns_character(character_id));

DROP POLICY "Owners can update inventory" ON public.character_inventory;
CREATE POLICY "Owners can update inventory" ON public.character_inventory FOR UPDATE TO authenticated 
  USING (owns_character(character_id));

DROP POLICY "Owners can delete inventory" ON public.character_inventory;
CREATE POLICY "Owners can delete inventory" ON public.character_inventory FOR DELETE TO authenticated 
  USING (owns_character(character_id));

-- Fix admin write policies for world tables
DROP POLICY "Admins can insert regions" ON public.regions;
CREATE POLICY "Admins can insert regions" ON public.regions FOR INSERT TO authenticated WITH CHECK (is_maiar_or_valar());
DROP POLICY "Admins can update regions" ON public.regions;
CREATE POLICY "Admins can update regions" ON public.regions FOR UPDATE TO authenticated USING (is_maiar_or_valar());
DROP POLICY "Admins can delete regions" ON public.regions;
CREATE POLICY "Admins can delete regions" ON public.regions FOR DELETE TO authenticated USING (is_maiar_or_valar());

DROP POLICY "Admins can insert nodes" ON public.nodes;
CREATE POLICY "Admins can insert nodes" ON public.nodes FOR INSERT TO authenticated WITH CHECK (is_maiar_or_valar());
DROP POLICY "Admins can update nodes" ON public.nodes;
CREATE POLICY "Admins can update nodes" ON public.nodes FOR UPDATE TO authenticated USING (is_maiar_or_valar());
DROP POLICY "Admins can delete nodes" ON public.nodes;
CREATE POLICY "Admins can delete nodes" ON public.nodes FOR DELETE TO authenticated USING (is_maiar_or_valar());

DROP POLICY "Admins can insert creatures" ON public.creatures;
CREATE POLICY "Admins can insert creatures" ON public.creatures FOR INSERT TO authenticated WITH CHECK (is_maiar_or_valar());
DROP POLICY "Admins can update creatures" ON public.creatures;
CREATE POLICY "Admins can update creatures" ON public.creatures FOR UPDATE TO authenticated USING (is_maiar_or_valar());
DROP POLICY "Admins can delete creatures" ON public.creatures;
CREATE POLICY "Admins can delete creatures" ON public.creatures FOR DELETE TO authenticated USING (is_maiar_or_valar());

DROP POLICY "Admins can insert items" ON public.items;
CREATE POLICY "Admins can insert items" ON public.items FOR INSERT TO authenticated WITH CHECK (is_maiar_or_valar());
DROP POLICY "Admins can update items" ON public.items;
CREATE POLICY "Admins can update items" ON public.items FOR UPDATE TO authenticated USING (is_maiar_or_valar());
DROP POLICY "Admins can delete items" ON public.items;
CREATE POLICY "Admins can delete items" ON public.items FOR DELETE TO authenticated USING (is_maiar_or_valar());
