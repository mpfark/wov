-- Atomic administrative Area Type rename.
-- Lock order: durable request row, source/destination type keys alphabetically,
-- then affected areas by UUID. Browser roles receive only the public RPC.

CREATE TABLE IF NOT EXISTS public.admin_area_type_rename_request (
  request_id uuid PRIMARY KEY,
  caller_id uuid NOT NULL,
  source_name text NOT NULL,
  target_name text NOT NULL,
  color text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.admin_area_type_rename_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_area_type_rename_request FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_area_type_rename(
  _request_id uuid,
  _source_name text,
  _target_name text,
  _color text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  source_key text := lower(btrim(coalesce(_source_name, '')));
  target_key text := lower(btrim(coalesce(_target_name, '')));
  request_row public.admin_area_type_rename_request%ROWTYPE;
  affected_count integer;
  response jsonb;
BEGIN
  IF caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authenticated');
  END IF;
  IF NOT public.is_steward_or_overlord() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized');
  END IF;
  IF _request_id IS NULL OR source_key = '' OR target_key = ''
     OR source_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     OR target_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     OR _color IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request');
  END IF;

  INSERT INTO public.admin_area_type_rename_request
    (request_id, caller_id, source_name, target_name, color)
  VALUES (_request_id, caller, source_key, target_key, _color)
  ON CONFLICT (request_id) DO NOTHING;

  SELECT * INTO request_row
  FROM public.admin_area_type_rename_request
  WHERE request_id = _request_id
  FOR UPDATE;

  IF request_row.caller_id IS DISTINCT FROM caller
     OR request_row.source_name IS DISTINCT FROM source_key
     OR request_row.target_name IS DISTINCT FROM target_key
     OR request_row.color IS DISTINCT FROM _color THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'request_conflict');
  END IF;
  IF request_row.result IS NOT NULL THEN
    RETURN request_row.result || jsonb_build_object('replayed', true);
  END IF;
  IF source_key = target_key THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'unchanged_name');
  END IF;

  -- Deterministic type-key lock order; a collision is never merged.
  PERFORM name FROM public.area_types
  WHERE name IN (source_key, target_key)
  ORDER BY name
  FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.area_types WHERE name = source_key) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'source_not_found');
  END IF;
  IF EXISTS (SELECT 1 FROM public.area_types WHERE name = target_key) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'target_exists');
  END IF;

  PERFORM id FROM public.areas WHERE area_type = source_key ORDER BY id FOR UPDATE;

  INSERT INTO public.area_types (name, color) VALUES (target_key, _color);
  UPDATE public.areas SET area_type = target_key WHERE area_type = source_key;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  DELETE FROM public.area_types WHERE name = source_key;

  response := jsonb_build_object(
    'ok', true,
    'kind', 'renamed',
    'source_name', source_key,
    'target_name', target_key,
    'affected_area_count', affected_count,
    'replayed', false
  );
  UPDATE public.admin_area_type_rename_request SET result = response
  WHERE request_id = _request_id;
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_area_type_rename(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_area_type_rename(uuid, text, text, text) TO authenticated;
