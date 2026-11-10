-- Forward repair only; the managed migration runner owns the transaction.
-- Preserve existing function ownership, ACL and player/service-role behavior.
DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.combat2_guard_test_arena_location()'::regprocedure)) <> 'ab106416c687fafeae45f915257ee3c4' THEN
    RAISE EXCEPTION 'arena location guard drift';
  END IF;
  IF md5(pg_get_functiondef('public.combat2_test_admin_relocate(uuid,uuid,uuid)'::regprocedure)) <> 'd0fca59dd8f8478b63e49f1b1d692eaa'
    OR md5(pg_get_functiondef('public.combat2_test_reset_without_presence_gate(uuid,uuid,boolean)'::regprocedure)) <> '17067e70423ee3687388665725d2772c' THEN
    RAISE EXCEPTION 'arena admin caller drift';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.combat2_guard_test_arena_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $function$
DECLARE old_test boolean; new_test boolean; approved boolean;
BEGIN
 IF OLD.current_node_id IS NOT DISTINCT FROM NEW.current_node_id THEN RETURN NEW; END IF;
 SELECT EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=OLD.current_node_id) INTO old_test;
 SELECT EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=NEW.current_node_id) INTO new_test;
 IF NOT old_test AND NOT new_test THEN RETURN NEW; END IF;
 approved:=COALESCE(current_setting('app.combat2_depart_authorized',true),'')='true'
   OR COALESCE(current_setting('app.combat2_test_relocate_authorized',true),'')='true'
   OR COALESCE(current_setting('app.combat2_respawn_authorized',true),'')='true';
 IF NOT approved THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='test_arena_relocation_required'; END IF;
 IF auth.role()='service_role' THEN RETURN NEW; END IF;
 -- Only the existing admin relocation/reset lane may move another owner's tester.
 -- A transaction marker alone is not permission: authenticate the admin and
 -- validate the tester's existing access to the exact active destination arena.
 IF auth.uid() IS NOT NULL
   AND COALESCE(current_setting('app.combat2_test_relocate_authorized',true),'')='true'
   AND public.combat2_test_admin_allowed()
   AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
   AND NEW.id IS NOT DISTINCT FROM OLD.id
   AND new_test
   AND public.combat2_test_arena_access_allowed(NEW.user_id,NEW.id,NEW.current_node_id)
 THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='test_arena_not_authorized'; END IF;
 IF new_test AND NOT public.combat2_test_arena_access_allowed(auth.uid(),NEW.id,NEW.current_node_id) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='test_arena_not_authorized'; END IF;
 RETURN NEW;
END $function$;

-- CREATE OR REPLACE preserves the installed postgres owner and complete ACL.
-- No new public/authenticated/anon EXECUTE; trigger callers need no function grant.