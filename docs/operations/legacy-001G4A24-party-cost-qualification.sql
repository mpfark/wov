-- G4A24 forward preparation only; not installed. Exact G4A10 member-result qualification.
-- One atomic operation; preserve the existing definition metadata and ACL exactly.
DO $party_cost$
DECLARE
 fn oid:=to_regprocedure('public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)');
 definition text; before_metadata jsonb; after_metadata jsonb;
 needle text:=$old$SELECT jsonb_agg(jsonb_build_object('character_id',character_id,'display_name',display_name,'order',movement_order,'status',status,'cost',cost) ORDER BY movement_order) INTO outcomes FROM public.combat2_party_departure_member WHERE request_id=_request_id;$old$;
 replacement text:=$new$SELECT jsonb_agg(jsonb_build_object('character_id',m.character_id,'display_name',m.display_name,'order',m.movement_order,'status',m.status,'cost',m.cost) ORDER BY m.movement_order) INTO outcomes FROM public.combat2_party_departure_member m WHERE m.request_id=_request_id;$new$;
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'exact party departure function missing'; END IF;
 IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4b7f16cfd9da168704831ebf641740e9ce69cd206272a39244b076855adb1ea5'
  FROM pg_catalog.pg_proc p WHERE p.oid=fn) IS DISTINCT FROM true THEN RAISE EXCEPTION 'original source drift'; END IF;
 SELECT pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' INTO definition,before_metadata FROM pg_catalog.pg_proc p WHERE p.oid=fn;
 IF position(needle in definition)=0 OR position(needle in substring(definition FROM position(needle in definition)+length(needle)))>0 THEN
  RAISE EXCEPTION 'exact single result-aggregate boundary required';
 END IF;
 EXECUTE replace(definition,needle,replacement);
 SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_catalog.pg_proc p WHERE p.oid=fn;
 IF before_metadata IS DISTINCT FROM after_metadata OR
  (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e01ed3c1d24627771f40a95960eecd1b39eed7d089c371b2eb5abdf0884de7b1'
   FROM pg_catalog.pg_proc p WHERE p.oid=fn) IS DISTINCT FROM true THEN RAISE EXCEPTION 'result body or function metadata preservation failed'; END IF;
END;
$party_cost$;
