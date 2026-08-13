-- C3b configuration pinning: every configuration value the resolver consumes is
-- carried by the authoritative snapshot and covered by the tick's config digest.

CREATE OR REPLACE FUNCTION public.ability_config_version()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT md5(
    COALESCE((SELECT string_agg(a.id::text || ':' || md5(to_jsonb(a.*)::text), ',' ORDER BY a.id)
              FROM public.abilities a), '') || '|' ||
    COALESCE((SELECT string_agg(b.id::text || ':' || md5(to_jsonb(b.*)::text), ',' ORDER BY b.id)
              FROM public.base_abilities b), '') || '|' ||
    COALESCE((SELECT string_agg(x.id::text || ':' || md5(to_jsonb(x.*)::text), ',' ORDER BY x.id)
              FROM public.class_ability_assignments x), '') || '|' ||
    COALESCE((SELECT string_agg(r.id::text || ':' || md5(to_jsonb(r.*)::text), ',' ORDER BY r.id)
              FROM public.class_ability_roles r), '') || '|' ||
    COALESCE((SELECT string_agg(s.key || ':' || md5(to_jsonb(s.*)::text), ',' ORDER BY s.key)
              FROM public.applied_statuses s), '') || '|' ||
    COALESCE((SELECT string_agg(c.class_key || ':' || md5(to_jsonb(c.*)::text), ',' ORDER BY c.class_key)
              FROM public.classes c), '')
  )
$function$;

REVOKE ALL ON FUNCTION public.ability_config_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ability_config_version() TO service_role;

CREATE OR REPLACE FUNCTION public.encounter_state_digest(_encounter_id uuid, _scope jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH
  ids AS (
    SELECT
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'participantIds', '[]'::jsonb)) x), '{}'::uuid[]) AS part_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'creatureIds', '[]'::jsonb)) x), '{}'::uuid[]) AS creat_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'actionIds', '[]'::jsonb)) x), '{}'::uuid[]) AS act_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'effectIds', '[]'::jsonb)) x), '{}'::uuid[]) AS eff_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'inventoryIds', '[]'::jsonb)) x), '{}'::uuid[]) AS inv_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'castIds', '[]'::jsonb)) x), '{}'::uuid[]) AS cast_ids,
      COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(
        COALESCE(_scope->'engagementPairs', '[]'::jsonb)) x), '{}'::text[]) AS eng_pairs,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'lootTableIds', '[]'::jsonb)) x), '{}'::uuid[]) AS loot_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'partyIds', '[]'::jsonb)) x), '{}'::uuid[]) AS party_ids
  ),
  enc AS (SELECT * FROM public.encounters WHERE id = _encounter_id),
  parts AS (
    SELECT string_agg(ep.character_id::text || ':' ||
             extract(epoch from ep.joined_at)::bigint::text, ',' ORDER BY ep.character_id) s
    FROM public.encounter_participants ep, ids
    WHERE ep.encounter_id = _encounter_id AND ep.character_id = ANY(ids.part_ids)
  ),
  chars AS (
    SELECT string_agg(
             c.id::text || ':' || c.hp || '/' || c.max_hp || ':' || c.cp || '/' || c.max_cp ||
             ':' || c.mp || '/' || c.max_mp || ':' || c.level || ':' || c.xp || ':' || c.gold ||
             ':' || COALESCE(c.bhp, 0) || ':' || COALESCE(c.rp_total_earned, 0) ||
             ':' || COALESCE(c.current_node_id::text, '-'), ',' ORDER BY c.id) s
    FROM public.characters c, ids WHERE c.id = ANY(ids.part_ids)
  ),
  creats AS (
    SELECT string_agg(
             cr.id::text || ':' || cr.hp || '/' || cr.max_hp || ':' || cr.is_alive::text ||
             ':' || cr.spawn_seq || ':' || COALESCE(cr.drop_chance::text, '-') ||
             ':' || COALESCE(cr.loot_mode, '-') || ':' || COALESCE(cr.loot_table_id::text, '-') ||
             ':' || COALESCE(cr.is_humanoid::text, '-'),
             ',' ORDER BY cr.id) s
    FROM public.creatures cr, ids WHERE cr.id = ANY(ids.creat_ids)
  ),
  engs AS (
    SELECT string_agg(e.creature_id::text || '>' || e.character_id::text || ':' ||
             COALESCE(e.party_id_at_join::text, '-'), ',' ORDER BY e.creature_id, e.character_id) s
    FROM public.encounter_engagements e, ids
    WHERE e.encounter_id = _encounter_id
      AND (e.creature_id::text || '>' || e.character_id::text) = ANY(ids.eng_pairs)
  ),
  acts AS (
    SELECT string_agg(a.id::text || ':' || a.status || ':' || a.client_seq || ':' ||
             a.ability_key || ':' || COALESCE(a.target_creature_id::text, '-') || ':' ||
             COALESCE(a.target_character_id::text, '-') || ':' ||
             COALESCE(a.eligible_after_ms::text, '-'), ',' ORDER BY a.id) s
    FROM public.combat_actions a, ids WHERE a.id = ANY(ids.act_ids)
  ),
  effs AS (
    SELECT string_agg(ae.id::text || ':' || ae.stacks || ':' || ae.damage_per_tick ||
             ':' || ae.expires_at || ':' || COALESCE(ae.next_tick_at::text, '-'), ','
             ORDER BY ae.id) s
    FROM public.active_effects ae, ids WHERE ae.id = ANY(ids.eff_ids)
  ),
  equip AS (
    SELECT string_agg(ci.id::text || ':' || ci.current_durability || ':' ||
             COALESCE(ci.equipped_slot::text, '-') || ':' || ci.item_id::text, ','
             ORDER BY ci.id) s
    FROM public.character_inventory ci, ids WHERE ci.id = ANY(ids.inv_ids)
  ),
  casts AS (
    SELECT string_agg(ce.id::text || ':' || COALESCE(ce.cast_key, '-') || ':' ||
             COALESCE(extract(epoch from ce.started_at)::bigint::text, '-') || ':' ||
             COALESCE(extract(epoch from ce.resolved_at)::bigint::text, '-') || ':' ||
             md5(ce.payload::text), ',' ORDER BY ce.id) s
    FROM public.encounter_cast_events ce, ids WHERE ce.id = ANY(ids.cast_ids)
  ),
  cfg AS (
    SELECT md5(
      COALESCE((SELECT row_to_json(n.*)::text FROM public.loot_pool_config n LIMIT 1), '') || '|' ||
      COALESCE((SELECT string_agg(s.key || ':' || md5(to_jsonb(s.*)::text), ',' ORDER BY s.key)
                FROM public.applied_statuses s), '') || '|' ||
      COALESCE((SELECT string_agg(cc.key || '=' || cc.value, ',' ORDER BY cc.key)
                FROM public.combat_config cc), '') || '|' ||
      COALESCE((SELECT string_agg(w.id::text || ':' || md5(to_jsonb(w.*)::text), ',' ORDER BY w.id)
                FROM public.weapon_progression_config w), '') || '|' ||
      COALESCE((SELECT string_agg(b.id::text || ':' || md5(to_jsonb(b.*)::text), ',' ORDER BY b.id)
                FROM public.xp_boost b), '') || '|' ||
      COALESCE((SELECT string_agg(lte.id::text || ':' || lte.item_id::text || ':' || lte.weight, ','
                                  ORDER BY lte.id)
                FROM public.loot_table_entries lte, ids
                WHERE lte.loot_table_id = ANY(ids.loot_ids)), '') || '|' ||
      -- Party composition the resolver pinned (tank selection).
      COALESCE((SELECT string_agg(pt.id::text || ':' || COALESCE(pt.tank_id::text, '-') || ':' ||
                                  COALESCE(pt.leader_id::text, '-'), ',' ORDER BY pt.id)
                FROM public.parties pt, ids WHERE pt.id = ANY(ids.party_ids)), '') || '|' ||
      -- Ability configuration the loader resolved magnitudes from.
      public.ability_config_version()
    ) h
  )
  SELECT jsonb_build_object(
    'participants', md5(COALESCE((SELECT s FROM parts), '')),
    'characters',   md5(COALESCE((SELECT s FROM chars), '')),
    'creatures',    md5(COALESCE((SELECT s FROM creats), '')),
    'engagements',  md5(COALESCE((SELECT s FROM engs), '')),
    'actions',      md5(COALESCE((SELECT s FROM acts), '')),
    'effects',      md5(COALESCE((SELECT s FROM effs), '')),
    'equipment',    md5(COALESCE((SELECT s FROM equip), '')),
    'casts',        md5(COALESCE((SELECT s FROM casts), '')),
    'storedPower',  md5(COALESCE((SELECT e.stored_power || ':' || COALESCE(e.stored_power_cap::text, '-') ||
                                  ':' || COALESCE(e.stored_power_source_id::text, '-') FROM enc e), '')),
    'configVersion', (SELECT h FROM cfg)
  )
$function$;