-- Additive, service-controlled Combat2 canary boundary. No node is an ordinary
-- canary until an unexpired row is explicitly enabled. Test Arena nodes retain
-- their existing isolated eligibility.
CREATE TABLE public.combat2_canary_node (
  node_id uuid PRIMARY KEY REFERENCES public.nodes(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

ALTER TABLE public.combat2_canary_node ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.combat2_canary_node FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.combat2_canary_node TO service_role;

CREATE FUNCTION public.combat2_node_runtime_eligible(_node_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT _node_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.combat2_test_arena_node n
      JOIN public.combat2_test_arena a ON a.id=n.arena_id
      WHERE n.node_id=_node_id AND n.active AND a.active
    ) OR EXISTS (
      SELECT 1 FROM public.combat2_canary_node c
      WHERE c.node_id=_node_id AND c.enabled AND c.expires_at>now()
    )
  )
$$;
REVOKE ALL ON FUNCTION public.combat2_node_runtime_eligible(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_node_runtime_eligible(uuid) TO service_role;

-- Authenticated self-check. It exposes only the requested node's eligibility;
-- the allowlist itself remains private and outside Realtime publication.
CREATE FUNCTION public.combat2_session_access(_character_id uuid,_node_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE is_arena boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.id=_character_id AND c.user_id=auth.uid() AND c.current_node_id=_node_id
  ) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
  IF NOT public.combat_mode_is_open() THEN
    RETURN jsonb_build_object('ok',false,'kind','mode_refused');
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.combat2_test_arena_node n WHERE n.node_id=_node_id AND n.active)
    INTO is_arena;
  IF is_arena AND NOT public.combat2_test_arena_access_allowed(auth.uid(),_character_id,_node_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','not_authorized');
  END IF;
  IF NOT public.combat2_node_runtime_eligible(_node_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','not_enabled');
  END IF;
  RETURN jsonb_build_object('ok',true,'kind','allowed','node_id',_node_id,
    'scope',CASE WHEN is_arena THEN 'test_arena' ELSE 'canary' END);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'kind','access_check_failed');
END $$;
REVOKE ALL ON FUNCTION public.combat2_session_access(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_session_access(uuid,uuid) TO authenticated;

-- Preserve installed implementations behind narrow eligibility wrappers.
ALTER FUNCTION public.combat_enter(uuid,uuid) RENAME TO combat_enter_without_canary_gate;
REVOKE ALL ON FUNCTION public.combat_enter_without_canary_gate(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat_enter_without_canary_gate(uuid,uuid) TO service_role;
CREATE FUNCTION public.combat_enter(_character_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE node_id uuid;
BEGIN
  SELECT current_node_id INTO node_id FROM public.characters WHERE id=_character_id;
  IF NOT public.combat2_node_runtime_eligible(node_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','scope_refused','reason','node_not_enabled');
  END IF;
  RETURN public.combat_enter_without_canary_gate(_character_id,_request_id);
END $$;
REVOKE ALL ON FUNCTION public.combat_enter(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat_enter(uuid,uuid) TO authenticated,service_role;

ALTER FUNCTION public.node_tick_claim(uuid,integer) RENAME TO node_tick_claim_without_canary_gate;
REVOKE ALL ON FUNCTION public.node_tick_claim_without_canary_gate(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim_without_canary_gate(uuid,integer) TO service_role;
CREATE FUNCTION public.node_tick_claim(_node_id uuid,_lease_ms integer DEFAULT 5000)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.combat2_node_runtime_eligible(_node_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','no_claim','reason','scope_refused');
  END IF;
  RETURN public.node_tick_claim_without_canary_gate(_node_id,_lease_ms);
END $$;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid,integer) TO service_role;

ALTER FUNCTION public.combat2_due_nodes(integer) RENAME TO combat2_due_nodes_without_canary_gate;
REVOKE ALL ON FUNCTION public.combat2_due_nodes_without_canary_gate(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_due_nodes_without_canary_gate(integer) TO service_role;
CREATE FUNCTION public.combat2_due_nodes(_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source jsonb; candidates jsonb;
BEGIN
  source:=public.combat2_due_nodes_without_canary_gate(_limit);
  IF COALESCE((source->>'ok')::boolean,false)=false THEN RETURN source; END IF;
  SELECT COALESCE(jsonb_agg(candidate ORDER BY candidate->>'next_due_at',candidate->>'node_id'),'[]'::jsonb)
    INTO candidates
    FROM jsonb_array_elements(COALESCE(source->'candidates','[]'::jsonb)) candidate
    WHERE public.combat2_node_runtime_eligible((candidate->>'node_id')::uuid);
  RETURN source || jsonb_build_object('candidate_count',jsonb_array_length(candidates),'candidates',candidates);
END $$;
REVOKE ALL ON FUNCTION public.combat2_due_nodes(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_due_nodes(integer) TO service_role;

-- Node-authoritative movement may leave the origin only for another explicitly
-- eligible node. This prevents an active canary session from mutating a node
-- outside the bounded scope. Idempotent result readers remain unchanged.
ALTER FUNCTION public.combat2_depart(uuid,uuid,uuid) RENAME TO combat2_depart_without_canary_gate;
REVOKE ALL ON FUNCTION public.combat2_depart_without_canary_gate(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_depart_without_canary_gate(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.combat2_depart(_character_id uuid,_destination_node_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.combat2_node_runtime_eligible(_destination_node_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','scope_refused','reason','destination_not_enabled');
  END IF;
  RETURN public.combat2_depart_without_canary_gate(_character_id,_destination_node_id,_request_id);
END $$;
REVOKE ALL ON FUNCTION public.combat2_depart(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_depart(uuid,uuid,uuid) TO authenticated,service_role;

ALTER FUNCTION public.combat2_party_depart(uuid,uuid,uuid) RENAME TO combat2_party_depart_without_canary_gate;
REVOKE ALL ON FUNCTION public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.combat2_party_depart(_leader_character_id uuid,_destination_node_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.combat2_node_runtime_eligible(_destination_node_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','scope_refused','reason','destination_not_enabled');
  END IF;
  RETURN public.combat2_party_depart_without_canary_gate(_leader_character_id,_destination_node_id,_request_id);
END $$;
REVOKE ALL ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) TO authenticated,service_role;

ALTER FUNCTION public.combat2_respawn(uuid,uuid) RENAME TO combat2_respawn_without_canary_gate;
REVOKE ALL ON FUNCTION public.combat2_respawn_without_canary_gate(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_respawn_without_canary_gate(uuid,uuid) TO service_role;
CREATE FUNCTION public.combat2_respawn(_character_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE destination uuid;
BEGIN
  SELECT default_node_id INTO destination FROM public.combat2_respawn_config WHERE singleton;
  IF NOT public.combat2_node_runtime_eligible(destination) THEN
    RETURN jsonb_build_object('ok',false,'kind','scope_refused','reason','respawn_destination_not_enabled');
  END IF;
  RETURN public.combat2_respawn_without_canary_gate(_character_id,_request_id);
END $$;
REVOKE ALL ON FUNCTION public.combat2_respawn(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_respawn(uuid,uuid) TO authenticated,service_role;
