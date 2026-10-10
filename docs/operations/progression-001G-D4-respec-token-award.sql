-- Reviewed forward SQL input; standard Lovable Drizzle registration only.
BEGIN;
DO $guard$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'D4 requires postgres installer/scheduler owner'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_receipt'::regclass
 AND conname='progression_receipt_operation_check' AND convalidated
 AND pg_get_constraintdef(oid) = 'CHECK ((operation = ANY (ARRAY[''xp''::text, ''permanent''::text, ''order''::text, ''respec''::text, ''renown''::text])))')
 THEN RAISE EXCEPTION 'D4 receipt operation constraint drift'; END IF;
END $guard$;
ALTER TABLE public.progression_receipt DROP CONSTRAINT progression_receipt_operation_check;
ALTER TABLE public.progression_receipt ADD CONSTRAINT progression_receipt_operation_check
 CHECK(operation IN('xp','permanent','order','respec','renown','admin_token'));
CREATE UNIQUE INDEX progression_admin_token_request ON public.progression_receipt(event_id) WHERE source='admin_respec_token';
-- Detailed reason expires; durable progression/replay proof uses only its digest.
CREATE TABLE public.admin_respec_award_log (
 request_id uuid PRIMARY KEY, character_id uuid NOT NULL, actor_id uuid NOT NULL,
 amount integer NOT NULL CHECK(amount BETWEEN 1 AND 5), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT transaction_timestamp()+interval '12 months'
);
ALTER TABLE public.admin_respec_award_log OWNER TO postgres;
ALTER TABLE public.admin_respec_award_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_respec_award_log FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.admin_respec_award_log_expire_internal() RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DELETE FROM public.admin_respec_award_log WHERE expires_at<=transaction_timestamp();
$$;
ALTER FUNCTION public.admin_respec_award_log_expire_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_respec_award_log_expire_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.admin_respec_award_internal(_actor uuid,_character uuid,_request uuid,_amount integer,_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE; role_name text; node_id uuid; v bigint; req jsonb; prior public.progression_receipt%ROWTYPE;
 valid jsonb; before_state jsonb; result jsonb; clean_reason text := regexp_replace(_reason,'^[[:space:]]+|[[:space:]]+$','','g');
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
 IF _actor IS NULL OR _character IS NULL OR _request IS NULL OR _amount IS NULL OR _reason IS NULL
 OR length(clean_reason) NOT BETWEEN 1 AND 1000 THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
 SELECT role::text INTO role_name FROM public.user_roles WHERE user_id=_actor FOR SHARE;
 IF role_name IS NULL OR role_name NOT IN('steward','overlord') THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 IF _amount<1 OR _amount>(CASE WHEN role_name='steward' THEN 1 ELSE 5 END) THEN RETURN jsonb_build_object('kind','refused','reason','award_cap'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('admin_respec_request:'||_request::text,0));
 req:=jsonb_build_object('actorId',_actor,'characterId',_character,'amount',_amount,
 'reasonDigest',encode(sha256(convert_to(clean_reason,'UTF8')),'hex'),'contractVersion',1);
 SELECT current_node_id INTO node_id FROM public.characters WHERE id=_character;
 IF node_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||node_id::text,0)); END IF;
 SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;
 IF NOT FOUND OR c.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('kind','refused','reason','invalid_target'); END IF;
 IF c.current_node_id IS DISTINCT FROM node_id THEN RETURN jsonb_build_object('kind','refused','reason','location_changed'); END IF;
 IF role_name='steward' AND c.user_id=_actor THEN RETURN jsonb_build_object('kind','refused','reason','self_reward_denied'); END IF;
 SELECT * INTO prior FROM public.progression_receipt WHERE source='admin_respec_token' AND event_id=_request;
 IF FOUND THEN
  IF prior.request IS DISTINCT FROM req THEN RETURN jsonb_build_object('kind','refused','reason','request_conflict'); END IF;
  RETURN jsonb_build_object('kind','replayed','original',prior.receipt);
 END IF;
 SELECT version INTO v FROM public.progression_character_state WHERE character_id=c.id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','refused','reason','missing_provenance'); END IF;
 valid:=public.progression_validate_fresh_internal(c.id,v,'admin_token');
 IF valid->>'kind'<>'valid' THEN RETURN valid; END IF;
 IF c.respec_points::bigint+_amount>2147483647 THEN RETURN jsonb_build_object('kind','refused','reason','arithmetic_overflow'); END IF;
 before_state:=public.progression_snapshot_internal(c.id)||jsonb_build_object('lifetimeRp',c.rp_total_earned);
 UPDATE public.characters SET respec_points=respec_points+_amount WHERE id=c.id;
 UPDATE public.progression_character_state SET version=version+1 WHERE character_id=c.id;
 result:=jsonb_build_object('characterId',c.id,'actorId',_actor,'eventId',_request,'operation','admin_token',
 'source','admin_respec_token','amount',_amount,'selfReward',c.user_id=_actor,'versionBefore',v,'versionAfter',v+1,
 'before',before_state,'after',public.progression_snapshot_internal(c.id)||jsonb_build_object('lifetimeRp',c.rp_total_earned));
 INSERT INTO public.progression_receipt VALUES(c.id,'admin_respec_token',_request,'admin_token',req,result);
 INSERT INTO public.admin_respec_award_log(request_id,character_id,actor_id,amount,reason) VALUES(_request,c.id,_actor,_amount,clean_reason);
 RETURN jsonb_build_object('kind','committed','receipt',result);
END $$;
ALTER FUNCTION public.admin_respec_award_internal(uuid,uuid,uuid,integer,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_respec_award_internal(uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.admin_respec_award(_actor uuid,_character uuid,_request uuid,_amount integer,_reason text)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.admin_respec_award_internal(_actor,_character,_request,_amount,_reason);
$$;
ALTER FUNCTION public.admin_respec_award(uuid,uuid,uuid,integer,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_respec_award(uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_respec_award(uuid,uuid,uuid,integer,text) TO service_role;
-- Remove default-granted custom access on these NEW objects only.
DO $acl$
DECLARE r record; f regprocedure;
BEGIN
 FOR r IN SELECT DISTINCT a.grantee FROM pg_class c, LATERAL aclexplode(c.relacl) a
 WHERE c.oid='public.admin_respec_award_log'::regclass AND a.grantee<>c.relowner AND a.grantee<>0 LOOP
  EXECUTE format('REVOKE ALL ON public.admin_respec_award_log FROM %I',(SELECT rolname FROM pg_roles WHERE oid=r.grantee));
 END LOOP;
 FOREACH f IN ARRAY ARRAY['public.admin_respec_award_log_expire_internal()'::regprocedure,
 'public.admin_respec_award_internal(uuid,uuid,uuid,integer,text)'::regprocedure,
 'public.admin_respec_award(uuid,uuid,uuid,integer,text)'::regprocedure] LOOP
  FOR r IN SELECT DISTINCT a.grantee FROM pg_proc p, LATERAL aclexplode(p.proacl) a
   WHERE p.oid=f AND a.grantee<>p.proowner AND a.grantee<>0
    AND NOT(f='public.admin_respec_award(uuid,uuid,uuid,integer,text)'::regprocedure AND a.grantee='service_role'::regrole) LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,(SELECT rolname FROM pg_roles WHERE oid=r.grantee));
  END LOOP;
  IF has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE')
  THEN RAISE EXCEPTION 'D4 inherited browser function access'; END IF;
 END LOOP;
END $acl$;
-- Existing pg_cron is a dependency, not a new scheduling framework.
DO $retention$
BEGIN
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='wov-admin-respec-reason-retention') THEN
  RAISE EXCEPTION 'D4 retention job already exists';
 END IF;
 PERFORM cron.schedule('wov-admin-respec-reason-retention','15 3 * * *',
  'SELECT public.admin_respec_award_log_expire_internal()');
END $retention$;
COMMIT;
