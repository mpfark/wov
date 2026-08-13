-- C2 validation harness (temporary; dropped by a follow-up migration).

CREATE OR REPLACE FUNCTION public.c2h_diff(_a jsonb, _b jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('before', _a->k, 'after', _b->k)), '{}'::jsonb)
  FROM jsonb_object_keys(COALESCE(_a, '{}'::jsonb)) AS k
  WHERE (_a->k) IS DISTINCT FROM (_b->k)
$$;

CREATE OR REPLACE FUNCTION public.c2h_rec(
  _tests jsonb, _id text, _expected text, _actual text,
  _before jsonb DEFAULT NULL, _after jsonb DEFAULT NULL, _note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _tests || jsonb_build_object(
    'id', _id,
    'expected', _expected,
    'actual', _actual,
    'zeroWriteChecked', _before IS NOT NULL,
    'zeroWrite', CASE WHEN _before IS NULL THEN NULL ELSE _before IS NOT DISTINCT FROM _after END,
    'beforeMd5', CASE WHEN _before IS NULL THEN NULL ELSE md5(_before::text) END,
    'afterMd5', CASE WHEN _after IS NULL THEN NULL ELSE md5(_after::text) END,
    'diff', CASE WHEN _before IS NULL THEN '{}'::jsonb ELSE public.c2h_diff(_before, _after) END,
    'note', _note,
    'pass', (_actual IS NOT DISTINCT FROM _expected)
            AND (_before IS NULL OR _before IS NOT DISTINCT FROM _after)
  )
$$;

-- Full authoritative state of the fixture world, per domain.
CREATE OR REPLACE FUNCTION public.c2h_state(
  _enc uuid, _chars uuid[], _creats uuid[], _node uuid
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'characters', COALESCE((SELECT string_agg(c.id::text||'|hp='||c.hp||'/'||c.max_hp||'|cp='||c.cp
        ||'|mp='||c.mp||'|lvl='||c.level||'|xp='||c.xp||'|gold='||c.gold
        ||'|rp='||COALESCE(c.rp_total_earned,0)||'|bhp='||c.bhp
        ||'|death='||COALESCE(c.last_death_at::text,'-')||'|res='||c.reserved_buffs::text
        ||'|stance='||c.stance_state::text||'|pts='||c.unspent_stat_points, ',' ORDER BY c.id)
      FROM public.characters c WHERE c.id = ANY(_chars)), ''),
    'creatures', COALESCE((SELECT string_agg(cr.id::text||'|hp='||cr.hp||'/'||cr.max_hp
        ||'|alive='||cr.is_alive::text||'|seq='||cr.spawn_seq
        ||'|died='||COALESCE(cr.died_at::text,'-')||'|awarded='||COALESCE(cr.rewards_awarded_at::text,'-'),
        ',' ORDER BY cr.id)
      FROM public.creatures cr WHERE cr.id = ANY(_creats)), ''),
    'actions', COALESCE((SELECT string_agg(a.id::text||'|'||a.status||'|seq='||a.client_seq
        ||'|tick='||COALESCE(a.consumed_tick::text,'-')||'|rej='||COALESCE(a.reject_reason,'-'),
        ',' ORDER BY a.id)
      FROM public.combat_actions a WHERE a.encounter_id = _enc), ''),
    'effects', COALESCE((SELECT string_agg(ae.id::text||'|'||ae.effect_type||'|st='||ae.stacks
        ||'|dpt='||ae.damage_per_tick||'|exp='||ae.expires_at, ',' ORDER BY ae.id)
      FROM public.active_effects ae
      WHERE ae.target_id = ANY(_chars) OR ae.target_id = ANY(_creats)
        OR ae.source_id = ANY(_chars) OR ae.source_id = ANY(_creats)), ''),
    'engagements', COALESCE((SELECT string_agg(e.creature_id::text||'>'||e.character_id::text, ','
        ORDER BY e.creature_id, e.character_id)
      FROM public.encounter_engagements e WHERE e.encounter_id = _enc), ''),
    'participants', COALESCE((SELECT string_agg(p.character_id::text, ',' ORDER BY p.character_id)
      FROM public.encounter_participants p WHERE p.encounter_id = _enc), ''),
    'inventory', COALESCE((SELECT string_agg(ci.id::text||'|dur='||ci.current_durability
        ||'|slot='||COALESCE(ci.equipped_slot::text,'-'), ',' ORDER BY ci.id)
      FROM public.character_inventory ci WHERE ci.character_id = ANY(_chars)), ''),
    'materials', COALESCE((SELECT string_agg(m.character_id::text||'|'||m.material_key||'='||m.count, ','
        ORDER BY m.character_id, m.material_key)
      FROM public.character_materials m WHERE m.character_id = ANY(_chars)), ''),
    'killAwards', COALESCE((SELECT string_agg(k.death_id::text||'|'||k.character_id::text||'|'||k.award_kind
        ||'|seq='||k.spawn_seq||'|tick='||k.tick_number, ','
        ORDER BY k.death_id, k.character_id, k.award_kind)
      FROM public.encounter_kill_awards k WHERE k.encounter_id = _enc), ''),
    'deathLoot', COALESCE((SELECT string_agg(d.death_id::text||'|'||d.mode||'|item='||COALESCE(d.item_id::text,'-')
        ||'|chance='||d.drop_chance||'|resolved='||d.resolved::text||'|seq='||d.spawn_seq, ','
        ORDER BY d.death_id)
      FROM public.encounter_death_loot d WHERE d.encounter_id = _enc), ''),
    'groundLoot', COALESCE((SELECT string_agg(g.item_id::text||'|'||COALESCE(g.creature_name,'-'), ','
        ORDER BY g.id) FROM public.node_ground_loot g WHERE g.node_id = _node), ''),
    'casts', COALESCE((SELECT string_agg(ce.id::text||'|'||ce.cast_key||'|resolved='||COALESCE(ce.resolved_at::text,'-')
        ||'|p='||md5(ce.payload::text), ',' ORDER BY ce.id)
      FROM public.encounter_cast_events ce WHERE ce.encounter_id = _enc), ''),
    'contributions', COALESCE((SELECT string_agg(k.character_id::text||'|dmg='||k.damage_dealt||'|heal='||k.healing_done,
        ',' ORDER BY k.character_id)
      FROM public.encounter_contributions k WHERE k.encounter_id = _enc), ''),
    'batches', COALESCE((SELECT string_agg(b.tick_number::text||'|'||b.batch_id::text, ',' ORDER BY b.tick_number)
      FROM public.encounter_tick_batches b WHERE b.encounter_id = _enc), ''),
    'sessions', COALESCE((SELECT string_agg(s.id::text||'|'||COALESCE(s.character_id::text,'-'), ',' ORDER BY s.id)
      FROM public.combat_sessions s WHERE s.node_id = _node), ''),
    'encounterCursor', COALESCE((SELECT 'tick='||e.tick_number||'|state='||e.tick_state
        ||'|resolving='||COALESCE(e.resolving_tick::text,'-')||'|token='||COALESCE(e.claim_token::text,'-')
        ||'|resolver='||COALESCE(e.resolver_id::text,'-')||'|lease='||COALESCE(e.lease_until::text,'-')
        ||'|attempt='||e.attempt||'|version='||e.version||'|status='||e.status
      FROM public.encounters e WHERE e.id = _enc), ''),
    'storedPower', COALESCE((SELECT 'sp='||e.stored_power||'|cap='||COALESCE(e.stored_power_cap::text,'-')
        ||'|src='||COALESCE(e.stored_power_source_id::text,'-')
      FROM public.encounters e WHERE e.id = _enc), ''),
    'worldState', COALESCE((SELECT string_agg(w.id::text||'|'||w.state, ',' ORDER BY w.id)
      FROM public.world_state w), ''),
    'combatConfig', COALESCE((SELECT string_agg(cc.key||'='||cc.value, ',' ORDER BY cc.key)
      FROM public.combat_config cc), '')
  )
$$;

-- Fault injection: only ever fires for the session that sets c2h.fail_at.
CREATE OR REPLACE FUNCTION public.c2h_fault() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('c2h.fail_at', true), '') = TG_ARGV[0] THEN
    RAISE EXCEPTION 'c2h_forced_fault_%', TG_ARGV[0];
  END IF;
  RETURN NULL;
END;
$$;

-- Forces a concurrent-looking duplicate batch row mid-commit.
CREATE OR REPLACE FUNCTION public.c2h_dup_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_cfg text := COALESCE(current_setting('c2h.dup_batch', true), '');
BEGIN
  IF v_cfg <> '' THEN
    INSERT INTO public.encounter_tick_batches (encounter_id, tick_number, batch_id, payload)
    VALUES (split_part(v_cfg, ':', 1)::uuid, split_part(v_cfg, ':', 2)::bigint,
            gen_random_uuid(), jsonb_build_object('c2h', 'racing_batch'));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.c2h_diff(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.c2h_rec(jsonb, text, text, text, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.c2h_state(uuid, uuid[], uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.c2h_fault() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.c2h_dup_batch() FROM PUBLIC, anon, authenticated;