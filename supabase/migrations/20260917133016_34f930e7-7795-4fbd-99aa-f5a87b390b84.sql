-- Atomic admin creation of a region with an optional server-derived initial node.
-- Lock order: durable request row, transaction-scoped creation advisory lock, then inserts.

CREATE TABLE public.admin_region_creation_request (
  request_id uuid PRIMARY KEY,
  caller_id uuid NOT NULL,
  region_name text,
  region_description text,
  min_level integer,
  max_level integer,
  create_initial_node boolean,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.admin_region_creation_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_region_creation_request FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.admin_region_creation_request FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_region_with_initial_node(
  _request_id uuid,
  _region_name text,
  _region_description text,
  _min_level integer,
  _max_level integer,
  _create_initial_node boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  prior public.admin_region_creation_request%ROWTYPE;
  clean_name text := btrim(_region_name);
  clean_description text := coalesce(_region_description, '');
  initial_node_name text;
  initial_x bigint;
  new_region_id uuid;
  new_node_id uuid;
  response jsonb;
BEGIN
  IF caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authenticated');
  END IF;
  IF NOT public.is_steward_or_overlord() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized');
  END IF;
  IF _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request');
  END IF;

  INSERT INTO public.admin_region_creation_request (
    request_id, caller_id, region_name, region_description,
    min_level, max_level, create_initial_node
  ) VALUES (
    _request_id, caller, _region_name, _region_description,
    _min_level, _max_level, _create_initial_node
  ) ON CONFLICT (request_id) DO NOTHING;

  SELECT * INTO prior
  FROM public.admin_region_creation_request
  WHERE request_id = _request_id
  FOR UPDATE;

  IF prior.caller_id IS DISTINCT FROM caller
     OR prior.region_name IS DISTINCT FROM _region_name
     OR prior.region_description IS DISTINCT FROM _region_description
     OR prior.min_level IS DISTINCT FROM _min_level
     OR prior.max_level IS DISTINCT FROM _max_level
     OR prior.create_initial_node IS DISTINCT FROM _create_initial_node
  THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'request_conflict');
  END IF;
  IF prior.result IS NOT NULL THEN
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;

  initial_node_name := clean_name || ' Entrance';
  IF clean_name IS NULL OR clean_name = '' OR length(clean_name) > 200
     OR _region_description IS NULL
     OR _min_level IS NULL OR _max_level IS NULL
     OR _min_level < 1 OR _max_level < _min_level
     OR _create_initial_node IS NULL
     OR (_create_initial_node AND length(initial_node_name) > 200)
  THEN
    response := jsonb_build_object('ok', false, 'kind', 'invalid_request');
  ELSE
    -- Serialize this RPC's server-derived placement calculation and content inserts.
    PERFORM pg_advisory_xact_lock(hashtextextended('admin_create_region_with_initial_node', 0));
    BEGIN
      IF _create_initial_node THEN
        SELECT coalesce(max(x), 0)::bigint + 10 INTO initial_x FROM public.nodes;
        IF initial_x < -2147483648 OR initial_x > 2147483647 THEN
          response := jsonb_build_object('ok', false, 'kind', 'coordinate_exhausted');
        END IF;
      END IF;

      IF response IS NULL THEN
        INSERT INTO public.regions (name, description, min_level, max_level)
        VALUES (clean_name, clean_description, _min_level, _max_level)
        RETURNING id INTO new_region_id;

        IF _create_initial_node THEN
          INSERT INTO public.nodes (name, description, region_id, connections, x, y)
          VALUES (initial_node_name, '', new_region_id, '[]'::jsonb, initial_x::integer, 0)
          RETURNING id INTO new_node_id;
        END IF;

        response := jsonb_build_object(
          'ok', true,
          'kind', 'created',
          'region_id', new_region_id,
          'initial_node_id', new_node_id,
          'replayed', false
        );
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        response := jsonb_build_object('ok', false, 'kind', 'collision');
      WHEN check_violation OR not_null_violation OR foreign_key_violation THEN
        response := jsonb_build_object('ok', false, 'kind', 'invalid_request');
      WHEN OTHERS THEN
        response := jsonb_build_object('ok', false, 'kind', 'database_error');
    END;
  END IF;

  UPDATE public.admin_region_creation_request
  SET result = response
  WHERE request_id = _request_id;
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_region_with_initial_node(uuid,text,text,integer,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_region_with_initial_node(uuid,text,text,integer,integer,boolean) TO authenticated;