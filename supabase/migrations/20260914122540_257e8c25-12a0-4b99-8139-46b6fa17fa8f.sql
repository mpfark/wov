-- Permit non-adjacent authoritative travel outside active Combat2 processing,
-- while fencing every claim/departure state that could race the mutation.
BEGIN;

CREATE OR REPLACE FUNCTION public.combat2_special_transition_conflict(_character_id uuid,_node_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.combat2_departure_request d
   WHERE d.character_id=_character_id AND d.status='queued')
 OR EXISTS(SELECT 1 FROM public.combat2_party_departure_member m
   WHERE m.character_id=_character_id AND m.status='queued')
 OR EXISTS(SELECT 1 FROM public.node_fighter f JOIN public.node_encounter e ON e.id=f.encounter_id
   WHERE f.character_id=_character_id AND f.present AND e.status='active')
 OR EXISTS(SELECT 1 FROM public.node_encounter e
   WHERE e.node_id=_node_id AND e.status='active' AND e.claim_token IS NOT NULL
     AND e.claim_expires_at>clock_timestamp());
$$;
REVOKE ALL ON FUNCTION public.combat2_special_transition_conflict(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_special_transition_conflict(uuid,uuid) TO service_role;

DO $patch$
DECLARE d text; old_text text; new_text text;
BEGIN
 SELECT pg_get_functiondef('public.character_special_travel(uuid,text,uuid,uuid)'::regprocedure) INTO d;
 old_text:=' SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;';
 new_text:=old_text||E'\n IF public.combat2_special_transition_conflict(c.id,c.current_node_id) THEN RETURN jsonb_build_object(''ok'',false,''kind'',''transition_conflict''); END IF;';
 IF position(new_text in d)=0 THEN
  IF position(old_text in d)=0 THEN RAISE EXCEPTION 'unexpected character_special_travel contract'; END IF;
  d:=replace(d,old_text,new_text); EXECUTE d;
 END IF;

 SELECT pg_get_functiondef('public.hidden_path_search(uuid,uuid)'::regprocedure) INTO d;
 old_text:=' SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;';
 new_text:=old_text||E'\n IF public.combat2_special_transition_conflict(c.id,c.current_node_id) THEN RETURN jsonb_build_object(''ok'',false,''kind'',''transition_conflict''); END IF;';
 IF position(new_text in d)=0 THEN
  IF position(old_text in d)=0 THEN RAISE EXCEPTION 'unexpected hidden_path_search contract'; END IF;
  d:=replace(d,old_text,new_text); EXECUTE d;
 END IF;
END $patch$;

REVOKE ALL ON FUNCTION public.character_special_travel(uuid,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.character_special_travel(uuid,text,uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.hidden_path_search(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hidden_path_search(uuid,uuid) TO authenticated,service_role;

COMMIT;