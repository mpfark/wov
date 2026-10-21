-- WOV-IDEA-025 local forward candidate. Standard Drizzle owns the outer transaction.
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'material_grant_installer'; END IF;
 IF to_regclass('public.admin_material_grant_replay') IS NOT NULL
 OR to_regclass('public.admin_material_grant_log') IS NOT NULL
 OR to_regprocedure('public.admin_material_grant(uuid,uuid,uuid,text,integer,text)') IS NOT NULL
 OR to_regprocedure('public.admin_material_grant_log_expire_internal()') IS NOT NULL
 THEN RAISE EXCEPTION 'material_grant_exists_reconcile'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.character_materials'::regclass AND attname='count' AND atttypid='integer'::regtype AND attnotnull)
 THEN RAISE EXCEPTION 'material_grant_count_schema'; END IF;
 IF has_table_privilege('anon','public.character_materials','INSERT,UPDATE,DELETE')
 OR has_table_privilege('authenticated','public.character_materials','INSERT,UPDATE,DELETE')
 THEN RAISE EXCEPTION 'material_grant_browser_table_authority'; END IF;
 IF (SELECT count(*) FROM public.materials WHERE key IN('salvage','garnet','topaz','emerald','sapphire','pearl','amethyst'))<>7
 THEN RAISE EXCEPTION 'material_grant_catalogue_missing'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='wov-admin-material-reason-retention')
 THEN RAISE EXCEPTION 'material_grant_retention_job_exists'; END IF;
END $guard$;

-- Minimal non-reusable completion proof; no plaintext actor/target/reason/balance.
CREATE TABLE public.admin_material_grant_replay (
 request_id uuid PRIMARY KEY, request_digest text NOT NULL CHECK(length(request_digest)=64), self_grant boolean NOT NULL
);
CREATE TABLE public.admin_material_grant_log (
 request_id uuid PRIMARY KEY REFERENCES public.admin_material_grant_replay(request_id),
 actor_id uuid NOT NULL, character_id uuid NOT NULL, actor_role text NOT NULL,
 material_key text NOT NULL, amount integer NOT NULL CHECK(amount>0), reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 balance_before integer NOT NULL CHECK(balance_before>=0), balance_after integer NOT NULL CHECK(balance_after>=0),
 self_grant boolean NOT NULL, policy_version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT transaction_timestamp()+interval '12 months'
);
ALTER TABLE public.admin_material_grant_replay OWNER TO postgres;
ALTER TABLE public.admin_material_grant_log OWNER TO postgres;
ALTER TABLE public.admin_material_grant_replay ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_material_grant_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_material_grant_replay,public.admin_material_grant_log FROM PUBLIC,anon,authenticated,service_role;
-- Exact owner-authorized removal of reported platform table defaults on these NEW tables only.
-- This does not change default privileges, function EXECUTE or any existing object.
REVOKE SELECT,INSERT ON public.admin_material_grant_replay,public.admin_material_grant_log
 FROM sandbox_exec,sandbox_exec_gpclaklkaolyzfnooajt;

CREATE FUNCTION public.admin_material_grant(_actor uuid,_character uuid,_request uuid,_material text,_amount integer,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $grant$
DECLARE role_name text; c public.characters; prior public.admin_material_grant_replay;
 clean_reason text:=regexp_replace(_reason,'^[[:space:]]+|[[:space:]]+$','','g'); digest text; cap integer; before_count integer; after_count integer; affected integer;
BEGIN
 IF auth.uid() IS NOT NULL OR _actor IS NULL THEN RAISE EXCEPTION 'material_grant_unauthorized'; END IF;
 BEGIN
  SELECT role::text INTO STRICT role_name FROM public.user_roles WHERE user_id=_actor FOR SHARE;
 EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'material_grant_unauthorized';
 END;
 IF role_name IS NULL OR role_name NOT IN('steward','overlord') THEN RAISE EXCEPTION 'material_grant_unauthorized'; END IF;
 IF _character IS NULL OR _request IS NULL OR _amount IS NULL OR _amount<=0
 OR clean_reason IS NULL OR length(clean_reason) NOT BETWEEN 1 AND 1000
 OR _material IS NULL OR _material NOT IN('salvage','garnet','topaz','emerald','sapphire','pearl','amethyst')
 THEN RAISE EXCEPTION 'material_grant_invalid_request'; END IF;
 -- Approved policy v1: a reviewed forward revision changes these caps, never client input.
 cap:=CASE WHEN role_name='steward' THEN CASE WHEN _material='salvage' THEN 1000 ELSE 25 END
 ELSE CASE WHEN _material='salvage' THEN 100000 ELSE 1000 END END;
 digest:=encode(sha256(convert_to(jsonb_build_object('actor',_actor,'character',_character,'material',_material,
  'amount',_amount,'reason',clean_reason,'policy',1)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('admin_material_grant:'||_request::text,0));
 -- Character first; NO KEY UPDATE serializes writers while allowing child/FK KEY SHARE.
 -- No node, encounter, progression or equipment locks/writes afterward.
 SELECT * INTO c FROM public.characters WHERE id=_character FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'material_grant_invalid_target'; END IF;
 IF role_name='steward' AND c.user_id=_actor THEN RAISE EXCEPTION 'material_grant_self_denied'; END IF;
 SELECT * INTO prior FROM public.admin_material_grant_replay WHERE request_id=_request;
 IF FOUND THEN
  IF prior.request_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'material_grant_request_conflict'; END IF;
  -- Original committed result survives detail expiry; never a second grant or stale balance hint.
  RETURN jsonb_build_object('grant_outcome','committed','request_id',_request,'character_id',_character,
   'material_key',_material,'amount',_amount,'self_grant',prior.self_grant);
 END IF;
 IF _amount>cap THEN RAISE EXCEPTION 'material_grant_cap'; END IF;
 IF c.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'material_grant_inactive_target'; END IF;
 -- Dead but non-deleted characters are active lifecycle targets; no resurrection/resources change.
 PERFORM 1 FROM public.materials WHERE key=_material FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'material_grant_catalogue_missing'; END IF;
 SELECT count INTO before_count FROM public.character_materials WHERE character_id=c.id AND material_key=_material FOR UPDATE;
 IF NOT FOUND THEN before_count:=0;
 ELSIF before_count IS NULL OR before_count<0 THEN RAISE EXCEPTION 'material_grant_invalid_balance'; END IF;
 IF before_count::bigint+_amount>2147483647 THEN RAISE EXCEPTION 'material_grant_overflow'; END IF;
 INSERT INTO public.character_materials(character_id,material_key,count) VALUES(c.id,_material,_amount)
 ON CONFLICT(character_id,material_key) DO UPDATE SET count=character_materials.count+excluded.count,updated_at=transaction_timestamp()
 WHERE character_materials.count>=0 AND character_materials.count::bigint+excluded.count<=2147483647
 RETURNING count INTO after_count;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 OR after_count IS DISTINCT FROM before_count+_amount THEN RAISE EXCEPTION 'material_grant_balance_changed'; END IF;
 INSERT INTO public.admin_material_grant_replay VALUES(_request,digest,c.user_id=_actor);
 INSERT INTO public.admin_material_grant_log(request_id,actor_id,character_id,actor_role,material_key,amount,reason,balance_before,balance_after,self_grant)
 VALUES(_request,_actor,c.id,role_name,_material,_amount,clean_reason,before_count,after_count,c.user_id=_actor);
 RETURN jsonb_build_object('grant_outcome','committed','request_id',_request,'character_id',_character,
  'material_key',_material,'amount',_amount,'self_grant',c.user_id=_actor);
END $grant$;
ALTER FUNCTION public.admin_material_grant(uuid,uuid,uuid,text,integer,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_material_grant(uuid,uuid,uuid,text,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_material_grant(uuid,uuid,uuid,text,integer,text) TO service_role;

CREATE FUNCTION public.admin_material_grant_log_expire_internal() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $expiry$
 DELETE FROM public.admin_material_grant_log WHERE expires_at<=transaction_timestamp();
$expiry$;
ALTER FUNCTION public.admin_material_grant_log_expire_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_material_grant_log_expire_internal() FROM PUBLIC,anon,authenticated,service_role;
DO $acl$
BEGIN
 IF has_function_privilege('anon','public.admin_material_grant(uuid,uuid,uuid,text,integer,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.admin_material_grant(uuid,uuid,uuid,text,integer,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.admin_material_grant(uuid,uuid,uuid,text,integer,text)','EXECUTE')
 OR has_function_privilege('anon','public.admin_material_grant_log_expire_internal()','EXECUTE')
 OR has_function_privilege('authenticated','public.admin_material_grant_log_expire_internal()','EXECUTE')
 OR has_function_privilege('service_role','public.admin_material_grant_log_expire_internal()','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_class r,LATERAL aclexplode(COALESCE(r.relacl,acldefault('r',r.relowner))) a
  WHERE r.oid IN('public.admin_material_grant_log'::regclass,'public.admin_material_grant_replay'::regclass) AND a.grantee<>r.relowner)
 OR EXISTS(SELECT 1 FROM pg_roles role_entry CROSS JOIN pg_class private_table
  WHERE role_entry.rolname IN('anon','authenticated','service_role','sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt')
   AND private_table.oid IN('public.admin_material_grant_log'::regclass,'public.admin_material_grant_replay'::regclass)
   AND (EXISTS(SELECT 1 FROM aclexplode(acldefault('r',private_table.relowner)) table_privilege
       WHERE has_table_privilege(role_entry.oid,private_table.oid,table_privilege.privilege_type))
     OR has_any_column_privilege(role_entry.oid,private_table.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
 THEN RAISE EXCEPTION 'material_grant_authority_drift'; END IF;
END $acl$;
-- Existing pg_cron, daily bounded-purpose retention (separate from world scheduling).
SELECT cron.schedule('wov-admin-material-reason-retention','20 3 * * *','SELECT public.admin_material_grant_log_expire_internal()');
