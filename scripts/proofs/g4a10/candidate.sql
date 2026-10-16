-- LOCAL / NON-DEPLOYABLE. One guarded atomic operation in the disposable
-- G4A10 fixture only. NOT a public function replacement or migration.
DO $candidate$
DECLARE
 fn oid:=to_regprocedure('g4a6.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)');
 definition text; before_metadata jsonb; after_metadata jsonb;
 needle text:=$old$SELECT jsonb_agg(jsonb_build_object('character_id',character_id,'display_name',display_name,'order',movement_order,'status',status,'cost',cost) ORDER BY movement_order) INTO outcomes FROM g4a6.combat2_party_departure_member WHERE request_id=_request_id;$old$;
 replacement text:=$new$SELECT jsonb_agg(jsonb_build_object('character_id',m.character_id,'display_name',m.display_name,'order',m.movement_order,'status',m.status,'cost',m.cost) ORDER BY m.movement_order) INTO outcomes FROM g4a6.combat2_party_departure_member m WHERE m.request_id=_request_id;$new$;
BEGIN
 IF current_database() NOT LIKE 'g4a6_fixture_g4a10_%' OR to_regclass('g4a6.fixture_marker') IS NULL THEN
  RAISE EXCEPTION 'G4A10 disposable fixture required; not installation SQL';
 END IF;
 IF fn IS NULL THEN RAISE EXCEPTION 'exact fixture function missing'; END IF;
 IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e63e6cedb61b36ae2553fc15d7c3784e95512aa467c8f09e7b2f41fda95183ca'
  FROM pg_proc p WHERE p.oid=fn) IS DISTINCT FROM true THEN RAISE EXCEPTION 'original fixture source drift'; END IF;
 SELECT pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' INTO definition,before_metadata FROM pg_proc p WHERE p.oid=fn;
 IF position(needle in definition)=0 OR position(needle in substring(definition FROM position(needle in definition)+length(needle)))>0 THEN
  RAISE EXCEPTION 'exact single result-aggregate boundary required';
 END IF;
 EXECUTE replace(definition,needle,replacement);
 SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_proc p WHERE p.oid=fn;
 IF before_metadata IS DISTINCT FROM after_metadata OR
  (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='954b8ca828392f285e9f5c3e676fae184c6ab2545c2248cfa80a3d96db97ae14'
   FROM pg_proc p WHERE p.oid=fn) IS DISTINCT FROM true THEN RAISE EXCEPTION 'result body or function metadata preservation failed'; END IF;
END;
$candidate$;
