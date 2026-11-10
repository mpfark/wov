-- Disposable PostgreSQL fixture. Run only in an empty local database.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('fixture.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('fixture.role',true) $$;
CREATE TABLE public.characters(id uuid PRIMARY KEY,user_id uuid,current_node_id uuid);
CREATE TABLE public.combat2_test_arena_node(node_id uuid PRIMARY KEY,active boolean);
CREATE TABLE public.fixture_access(user_id uuid,character_id uuid,node_id uuid,active boolean);
CREATE FUNCTION public.combat2_test_admin_allowed() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('fixture.admin',true)='true' $$;
CREATE FUNCTION public.combat2_test_arena_access_allowed(u uuid,c uuid,n uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM public.fixture_access WHERE user_id=u AND character_id=c AND node_id=n AND active)
 AND EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=n AND active) $$;
INSERT INTO public.characters VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010');
INSERT INTO public.combat2_test_arena_node VALUES('00000000-0000-0000-0000-000000000011',true),('00000000-0000-0000-0000-000000000012',false);
INSERT INTO public.fixture_access VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',true);

-- Load the exact CREATE OR REPLACE body extracted from the reviewed candidate.
\i /tmp/engine-pg/guard.sql
CREATE TRIGGER location_guard BEFORE UPDATE OF current_node_id ON public.characters FOR EACH ROW EXECUTE FUNCTION public.combat2_guard_test_arena_location();

CREATE FUNCTION public.fixture_attempt(uid uuid,admin boolean,marker text,destination uuid,expect_allowed boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE allowed boolean:=true;
BEGIN
 PERFORM set_config('fixture.uid',coalesce(uid::text,''),true);
 PERFORM set_config('fixture.role','authenticated',true);
 PERFORM set_config('fixture.admin',admin::text,true);
 PERFORM set_config('app.combat2_test_relocate_authorized',CASE WHEN marker='admin' THEN 'true' ELSE '' END,true);
 PERFORM set_config('app.combat2_depart_authorized',CASE WHEN marker='depart' THEN 'true' ELSE '' END,true);
 BEGIN
  UPDATE public.characters SET current_node_id=destination;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN allowed:=false;
 END;
 IF allowed IS DISTINCT FROM expect_allowed THEN RAISE EXCEPTION 'expected allowed %, got %: uid %, admin %, marker %',expect_allowed,allowed,uid,admin,marker; END IF;
 -- Force fixture rollback after every attempt, including successful relocation.
 RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='fixture_case_passed';
END $$;
CREATE FUNCTION public.fixture_case(uid uuid,admin boolean,marker text,destination uuid,expect_allowed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.fixture_attempt(uid,admin,marker,destination,expect_allowed);
EXCEPTION WHEN SQLSTATE 'P0099' THEN RETURN;
END $$;

-- Owner-authorized player movement remains valid.
SELECT public.fixture_case('00000000-0000-0000-0000-000000000002',false,'depart','00000000-0000-0000-0000-000000000011',true);
-- Admin may relocate another owner's enrolled tester through the admin lane.
SELECT public.fixture_case('00000000-0000-0000-0000-000000000003',true,'admin','00000000-0000-0000-0000-000000000011',true);
-- Marker alone does not grant another player's ownership.
SELECT public.fixture_case('00000000-0000-0000-0000-000000000003',false,'admin','00000000-0000-0000-0000-000000000011',false);
-- Even admins cannot use the ordinary departure marker for another owner.
SELECT public.fixture_case('00000000-0000-0000-0000-000000000003',true,'depart','00000000-0000-0000-0000-000000000011',false);
-- Missing marker, missing auth and inactive destination all refuse.
SELECT public.fixture_case('00000000-0000-0000-0000-000000000003',true,'','00000000-0000-0000-0000-000000000011',false);
SELECT public.fixture_case(NULL,true,'admin','00000000-0000-0000-0000-000000000011',false);
SELECT public.fixture_case('00000000-0000-0000-0000-000000000003',true,'admin','00000000-0000-0000-0000-000000000012',false);
UPDATE public.fixture_access SET active=false;
SELECT public.fixture_case('00000000-0000-0000-0000-000000000003',true,'admin','00000000-0000-0000-0000-000000000011',false);
SELECT '8 arena guard cases passed' AS result;