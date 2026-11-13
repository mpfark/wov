CREATE OR REPLACE FUNCTION public.user_has_character_at_node(_node_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.characters c WHERE c.user_id = auth.uid() AND c.current_node_id = _node_id)
$$;
CREATE OR REPLACE FUNCTION public.user_has_character()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.characters c WHERE c.user_id = auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.user_can_see_encounter(_encounter_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.encounters e JOIN public.characters c ON c.current_node_id = e.node_id
                 WHERE e.id = _encounter_id AND c.user_id = auth.uid())
$$;
REVOKE EXECUTE ON FUNCTION public.user_has_character_at_node(uuid), public.user_has_character(), public.user_can_see_encounter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_character_at_node(uuid), public.user_has_character(), public.user_can_see_encounter(uuid) TO authenticated, service_role;

DROP POLICY "Authenticated users can view ground loot" ON public.node_ground_loot;
CREATE POLICY "Players at node can view ground loot" ON public.node_ground_loot FOR SELECT TO authenticated
  USING (public.user_has_character_at_node(node_id) OR public.is_steward_or_overlord());

DROP POLICY "Authenticated can read encounters" ON public.encounters;
CREATE POLICY "Players at node can read encounters" ON public.encounters FOR SELECT TO authenticated
  USING (public.user_has_character_at_node(node_id) OR public.is_steward_or_overlord());

DROP POLICY "Authenticated can read encounter_participants" ON public.encounter_participants;
CREATE POLICY "Players at node can read encounter_participants" ON public.encounter_participants FOR SELECT TO authenticated
  USING (public.user_has_character_at_node(node_id) OR public.is_steward_or_overlord());

DROP POLICY "Authenticated can read encounter_cast_events" ON public.encounter_cast_events;
CREATE POLICY "Players at node can read encounter_cast_events" ON public.encounter_cast_events FOR SELECT TO authenticated
  USING (public.user_can_see_encounter(encounter_id) OR public.is_steward_or_overlord());

DROP POLICY "Authenticated can read encounter_creatures" ON public.encounter_creatures;
CREATE POLICY "Players at node can read encounter_creatures" ON public.encounter_creatures FOR SELECT TO authenticated
  USING (public.user_can_see_encounter(encounter_id) OR public.is_steward_or_overlord());

DROP POLICY "Authenticated may read death loot" ON public.encounter_death_loot;
CREATE POLICY "Players at node can read death loot" ON public.encounter_death_loot FOR SELECT TO authenticated
  USING (public.user_can_see_encounter(encounter_id) OR public.is_steward_or_overlord());

DROP POLICY "Authenticated users can view listings" ON public.marketplace_listings;
CREATE POLICY "Players view active or own listings" ON public.marketplace_listings FOR SELECT TO authenticated
  USING (
    (status = 'active' AND public.user_has_character())
    OR EXISTS (SELECT 1 FROM public.characters c WHERE c.user_id = auth.uid() AND c.id IN (seller_character_id, buyer_character_id))
    OR public.is_steward_or_overlord());

DROP POLICY "Anyone can view loot table entries" ON public.loot_table_entries;
DROP POLICY "Anyone can view loot pool config" ON public.loot_pool_config;
CREATE POLICY "Staff can view loot pool config" ON public.loot_pool_config FOR SELECT TO authenticated
  USING (public.is_steward_or_overlord());

DROP POLICY "Authenticated users can view roadmap" ON public.roadmap_items;
CREATE POLICY "Players can view roadmap" ON public.roadmap_items FOR SELECT TO authenticated
  USING (public.user_has_character() OR public.is_steward_or_overlord());

DROP POLICY "Authenticated users can view xp boost" ON public.xp_boost;
CREATE POLICY "Players can view xp boost" ON public.xp_boost FOR SELECT TO authenticated
  USING (public.user_has_character() OR public.is_steward_or_overlord());

DROP POLICY "Applied statuses are readable by everyone" ON public.applied_statuses;
CREATE POLICY "Players can view applied statuses" ON public.applied_statuses FOR SELECT TO authenticated
  USING (public.user_has_character() OR public.is_steward_or_overlord());

DROP POLICY "Anyone can view appearance entries" ON public.appearance_entries;
CREATE POLICY "Players can view appearance entries" ON public.appearance_entries FOR SELECT TO authenticated
  USING (public.user_has_character() OR public.is_steward_or_overlord());