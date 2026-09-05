-- Empty, dormant authority for permanent Combat2 test arenas.
CREATE TABLE public.combat2_test_arena (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_key text NOT NULL UNIQUE CHECK (arena_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  description text,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.combat2_test_arena_node (
  node_id uuid PRIMARY KEY REFERENCES public.nodes(id) ON DELETE RESTRICT,
  arena_id uuid NOT NULL REFERENCES public.combat2_test_arena(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('staging','low','equal','high_damage','boss')),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (arena_id, purpose)
);
CREATE TABLE public.combat2_test_arena_access (
  arena_id uuid NOT NULL REFERENCES public.combat2_test_arena(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT false,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (arena_id,user_id,character_id),
  UNIQUE (arena_id,character_id),
  CHECK ((active AND revoked_at IS NULL) OR NOT active)
);
ALTER TABLE public.combat2_test_arena ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combat2_test_arena_node ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combat2_test_arena_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.combat2_test_arena,public.combat2_test_arena_node,public.combat2_test_arena_access FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.combat2_test_arena,public.combat2_test_arena_node,public.combat2_test_arena_access TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_test_arena_access_allowed(_user_id uuid,_character_id uuid,_node_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
 SELECT _user_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.combat2_test_arena_node n
  JOIN public.combat2_test_arena a ON a.id=n.arena_id AND a.active
  JOIN public.combat2_test_arena_access x ON x.arena_id=a.id AND x.user_id=_user_id
    AND x.character_id=_character_id AND x.active AND x.revoked_at IS NULL
  JOIN public.characters c ON c.id=x.character_id AND c.user_id=x.user_id
  WHERE n.node_id=_node_id AND n.active);
$$;
REVOKE ALL ON FUNCTION public.combat2_test_arena_access_allowed(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_test_arena_access_allowed(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_test_node_visible(_node_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.combat2_test_arena_node n WHERE n.node_id=_node_id)
 OR public.is_steward_or_overlord() OR EXISTS(
  SELECT 1 FROM public.combat2_test_arena_node n
  JOIN public.combat2_test_arena a ON a.id=n.arena_id AND a.active
  JOIN public.combat2_test_arena_access x ON x.arena_id=a.id AND x.user_id=auth.uid()
    AND x.active AND x.revoked_at IS NULL
  JOIN public.characters c ON c.id=x.character_id AND c.user_id=x.user_id
  WHERE n.node_id=_node_id AND n.active);
$$;
REVOKE ALL ON FUNCTION public.combat2_test_node_visible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_node_visible(uuid) TO authenticated,service_role;

DROP POLICY IF EXISTS "Anyone can view nodes" ON public.nodes;
DROP POLICY IF EXISTS "Visible nodes" ON public.nodes;
CREATE POLICY "Visible nodes" ON public.nodes FOR SELECT USING(
 public.combat2_test_node_visible(nodes.id));

ALTER TABLE public.node_encounter ADD COLUMN test_arena_id uuid
 REFERENCES public.combat2_test_arena(id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION public.combat2_bind_test_encounter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_arena uuid;
BEGIN
 IF TG_OP='INSERT' OR (OLD.status IS DISTINCT FROM 'active' AND NEW.status='active') THEN
  SELECT n.arena_id INTO v_arena FROM public.combat2_test_arena_node n
  JOIN public.combat2_test_arena a ON a.id=n.arena_id
  WHERE n.node_id=NEW.node_id AND n.active AND a.active;
  NEW.test_arena_id:=v_arena;
 ELSIF NEW.test_arena_id IS DISTINCT FROM OLD.test_arena_id THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='test_arena_identity_immutable';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.combat2_bind_test_encounter() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER combat2_bind_test_encounter BEFORE INSERT OR UPDATE OF status,test_arena_id ON public.node_encounter
 FOR EACH ROW EXECUTE FUNCTION public.combat2_bind_test_encounter();

CREATE OR REPLACE FUNCTION public.combat2_guard_test_arena_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE old_test boolean; new_test boolean; approved boolean;
BEGIN
 IF OLD.current_node_id IS NOT DISTINCT FROM NEW.current_node_id THEN RETURN NEW; END IF;
 SELECT EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=OLD.current_node_id) INTO old_test;
 SELECT EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=NEW.current_node_id) INTO new_test;
 IF NOT old_test AND NOT new_test THEN RETURN NEW; END IF;
 approved:=COALESCE(current_setting('app.combat2_depart_authorized',true),'')='true'
   OR COALESCE(current_setting('app.combat2_test_relocate_authorized',true),'')='true';
 IF NOT approved THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='test_arena_relocation_required'; END IF;
 IF auth.role()='service_role' THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='test_arena_not_authorized'; END IF;
 IF new_test AND NOT public.combat2_test_arena_access_allowed(auth.uid(),NEW.id,NEW.current_node_id) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='test_arena_not_authorized'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.combat2_guard_test_arena_location() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER combat2_guard_test_arena_location BEFORE UPDATE OF current_node_id ON public.characters
 FOR EACH ROW EXECUTE FUNCTION public.combat2_guard_test_arena_location();

CREATE OR REPLACE FUNCTION public.combat2_test_relocate(_character_id uuid,_destination_node_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE c public.characters; from_test boolean; to_test boolean;
BEGIN
 IF auth.role()<>'service_role' AND (auth.uid() IS NULL OR NOT public.owns_character(_character_id)) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=_destination_node_id) THEN RETURN jsonb_build_object('ok',false,'kind','invalid_destination'); END IF;
 SELECT EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=c.current_node_id) INTO from_test;
 SELECT EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=_destination_node_id) INTO to_test;
 IF NOT from_test AND NOT to_test THEN RETURN jsonb_build_object('ok',false,'kind','not_test_boundary'); END IF;
 IF auth.role()<>'service_role' AND to_test AND NOT public.combat2_test_arena_access_allowed(auth.uid(),_character_id,_destination_node_id) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF EXISTS(SELECT 1 FROM public.node_fighter nf JOIN public.node_encounter e ON e.id=nf.encounter_id
  WHERE nf.character_id=_character_id AND nf.present AND e.status='active') THEN RETURN jsonb_build_object('ok',false,'kind','combat2_depart_required'); END IF;
 PERFORM set_config('app.combat2_test_relocate_authorized','true',true);
 UPDATE public.characters SET current_node_id=_destination_node_id WHERE id=_character_id;
 RETURN jsonb_build_object('ok',true,'kind','moved');
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','relocation_refused');
END; $$;
REVOKE ALL ON FUNCTION public.combat2_test_relocate(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_relocate(uuid,uuid) TO authenticated,service_role;

DO $$ DECLARE d text; needle text:='''now'', now()'; BEGIN
 SELECT pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure) INTO d;
 IF position(needle in d)=0 OR position('''test_arena_id''' in d)>0 THEN RAISE EXCEPTION 'unexpected node_tick_claim contract'; END IF;
 EXECUTE replace(d,needle,'''now'', now(), ''test_arena_id'', e.test_arena_id');
END $$;
DO $$ DECLARE d text; needle text:='  IF e.tick >= _candidate_tick THEN'; patch text:=$p$
  IF e.test_arena_id IS NOT NULL AND jsonb_array_length(COALESCE(_proposed->'rewards','[]'::jsonb))<>0 THEN
    RETURN jsonb_build_object('ok',false,'kind','invalid_proposal','reason','test_rewards_forbidden');
  END IF;

  IF e.tick >= _candidate_tick THEN$p$; BEGIN
 SELECT pg_get_functiondef('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'::regprocedure) INTO d;
 IF position(needle in d)=0 OR position('test_rewards_forbidden' in d)>0 THEN RAISE EXCEPTION 'unexpected node_tick_commit contract'; END IF;
 EXECUTE replace(d,needle,patch);
END $$;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role;