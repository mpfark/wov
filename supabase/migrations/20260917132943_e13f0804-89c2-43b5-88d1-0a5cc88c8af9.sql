-- Server-authoritative ordinary reciprocal node connections.
-- Lock order: durable request row, then node rows in UUID order.

CREATE TABLE public.admin_node_connection_request (
  request_id uuid PRIMARY KEY,
  caller_id uuid NOT NULL,
  operation text NOT NULL,
  source_node_id uuid NOT NULL,
  target_node_id uuid NOT NULL,
  expected_source_entry jsonb NOT NULL,
  expected_target_entry jsonb NOT NULL,
  desired_direction text,
  desired_hidden boolean,
  desired_source_directional_metadata jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.admin_node_connection_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_node_connection_request FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.admin_node_connection_request FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_mutate_reciprocal_node_connection(
  _request_id uuid,
  _operation text,
  _source_node_id uuid,
  _target_node_id uuid,
  _expected_source_entry jsonb,
  _expected_target_entry jsonb,
  _desired_direction text,
  _desired_hidden boolean,
  _desired_source_directional_metadata jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller uuid := auth.uid();
  op text := lower(btrim(coalesce(_operation, '')));
  expected_source jsonb := coalesce(_expected_source_entry, 'null'::jsonb);
  expected_target jsonb := coalesce(_expected_target_entry, 'null'::jsonb);
  desired_metadata jsonb := coalesce(_desired_source_directional_metadata, '{}'::jsonb);
  desired_direction text := upper(btrim(coalesce(_desired_direction, '')));
  reverse_direction text;
  prior public.admin_node_connection_request%ROWTYPE;
  source_connections jsonb;
  target_connections jsonb;
  source_entry jsonb;
  target_entry jsonb;
  source_position bigint;
  target_position bigint;
  source_count integer;
  target_count integer;
  current_reverse text;
  new_source_entry jsonb;
  new_target_entry jsonb;
  response jsonb;
BEGIN
  IF caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authenticated');
  END IF;
  IF NOT public.is_steward_or_overlord() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized');
  END IF;

  reverse_direction := CASE desired_direction
    WHEN 'N' THEN 'S' WHEN 'S' THEN 'N' WHEN 'E' THEN 'W' WHEN 'W' THEN 'E'
    WHEN 'NE' THEN 'SW' WHEN 'SW' THEN 'NE' WHEN 'NW' THEN 'SE' WHEN 'SE' THEN 'NW'
  END;

  IF _request_id IS NULL OR _source_node_id IS NULL OR _target_node_id IS NULL
     OR _source_node_id = _target_node_id OR op NOT IN ('create', 'edit', 'remove')
     OR jsonb_typeof(desired_metadata) IS DISTINCT FROM 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(desired_metadata) AS key
       WHERE key NOT IN ('label', 'locked', 'lock_key', 'lock_hint')
     )
     OR (desired_metadata ? 'label' AND jsonb_typeof(desired_metadata->'label') IS DISTINCT FROM 'string')
     OR (desired_metadata ? 'locked' AND jsonb_typeof(desired_metadata->'locked') IS DISTINCT FROM 'boolean')
     OR (desired_metadata ? 'lock_key' AND jsonb_typeof(desired_metadata->'lock_key') IS DISTINCT FROM 'string')
     OR (desired_metadata ? 'lock_hint' AND jsonb_typeof(desired_metadata->'lock_hint') IS DISTINCT FROM 'string')
     OR (op = 'create' AND (expected_source <> 'null'::jsonb OR expected_target <> 'null'::jsonb))
     OR (op IN ('edit', 'remove') AND (jsonb_typeof(expected_source) IS DISTINCT FROM 'object' OR jsonb_typeof(expected_target) IS DISTINCT FROM 'object'))
     OR (op IN ('edit', 'remove') AND (
       expected_source->>'node_id' IS DISTINCT FROM _target_node_id::text
       OR expected_target->>'node_id' IS DISTINCT FROM _source_node_id::text
       OR upper(coalesce(expected_source->>'direction','')) NOT IN ('N','NE','E','SE','S','SW','W','NW')
       OR upper(coalesce(expected_target->>'direction','')) NOT IN ('N','NE','E','SE','S','SW','W','NW')
       OR (expected_source ? 'hidden' AND jsonb_typeof(expected_source->'hidden') IS DISTINCT FROM 'boolean')
       OR (expected_target ? 'hidden' AND jsonb_typeof(expected_target->'hidden') IS DISTINCT FROM 'boolean')
       OR (expected_source ? 'label' AND jsonb_typeof(expected_source->'label') IS DISTINCT FROM 'string')
       OR (expected_target ? 'label' AND jsonb_typeof(expected_target->'label') IS DISTINCT FROM 'string')
       OR (expected_source ? 'locked' AND jsonb_typeof(expected_source->'locked') IS DISTINCT FROM 'boolean')
       OR (expected_target ? 'locked' AND jsonb_typeof(expected_target->'locked') IS DISTINCT FROM 'boolean')
       OR (expected_source ? 'lock_key' AND jsonb_typeof(expected_source->'lock_key') IS DISTINCT FROM 'string')
       OR (expected_target ? 'lock_key' AND jsonb_typeof(expected_target->'lock_key') IS DISTINCT FROM 'string')
       OR (expected_source ? 'lock_hint' AND jsonb_typeof(expected_source->'lock_hint') IS DISTINCT FROM 'string')
       OR (expected_target ? 'lock_hint' AND jsonb_typeof(expected_target->'lock_hint') IS DISTINCT FROM 'string')
     ))
     OR (op IN ('create', 'edit') AND (reverse_direction IS NULL OR _desired_hidden IS NULL))
     OR (op = 'remove' AND (_desired_direction IS NOT NULL OR _desired_hidden IS NOT NULL OR desired_metadata <> '{}'::jsonb))
  THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request');
  END IF;

  INSERT INTO public.admin_node_connection_request (
    request_id, caller_id, operation, source_node_id, target_node_id,
    expected_source_entry, expected_target_entry, desired_direction,
    desired_hidden, desired_source_directional_metadata
  ) VALUES (
    _request_id, caller, op, _source_node_id, _target_node_id,
    expected_source, expected_target, NULLIF(desired_direction, ''),
    _desired_hidden, desired_metadata
  ) ON CONFLICT (request_id) DO NOTHING;

  SELECT * INTO prior
  FROM public.admin_node_connection_request
  WHERE request_id = _request_id
  FOR UPDATE;

  IF prior.caller_id IS DISTINCT FROM caller
     OR prior.operation IS DISTINCT FROM op
     OR prior.source_node_id IS DISTINCT FROM _source_node_id
     OR prior.target_node_id IS DISTINCT FROM _target_node_id
     OR prior.expected_source_entry IS DISTINCT FROM expected_source
     OR prior.expected_target_entry IS DISTINCT FROM expected_target
     OR prior.desired_direction IS DISTINCT FROM NULLIF(desired_direction, '')
     OR prior.desired_hidden IS DISTINCT FROM _desired_hidden
     OR prior.desired_source_directional_metadata IS DISTINCT FROM desired_metadata
  THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'request_conflict');
  END IF;
  IF prior.result IS NOT NULL THEN
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;

  <<mutation>>
  BEGIN
    PERFORM id FROM public.nodes
    WHERE id IN (_source_node_id, _target_node_id)
    ORDER BY id
    FOR UPDATE;

    SELECT connections INTO source_connections FROM public.nodes WHERE id = _source_node_id;
    SELECT connections INTO target_connections FROM public.nodes WHERE id = _target_node_id;
    IF source_connections IS NULL OR target_connections IS NULL THEN
      response := jsonb_build_object('ok', false, 'kind', 'node_not_found'); EXIT mutation;
    END IF;
    IF jsonb_typeof(source_connections) IS DISTINCT FROM 'array'
       OR jsonb_typeof(target_connections) IS DISTINCT FROM 'array' THEN
      response := jsonb_build_object('ok', false, 'kind', 'malformed_connection_state'); EXIT mutation;
    END IF;

    SELECT count(*), min(ord), (array_agg(value ORDER BY ord))[1]
      INTO source_count, source_position, source_entry
    FROM jsonb_array_elements(source_connections) WITH ORDINALITY AS entry(value, ord)
    WHERE value->>'node_id' = _target_node_id::text;
    SELECT count(*), min(ord), (array_agg(value ORDER BY ord))[1]
      INTO target_count, target_position, target_entry
    FROM jsonb_array_elements(target_connections) WITH ORDINALITY AS entry(value, ord)
    WHERE value->>'node_id' = _source_node_id::text;

    IF op = 'create' THEN
      IF source_count <> 0 OR target_count <> 0 THEN
        response := jsonb_build_object('ok', false, 'kind', 'connection_exists_or_conflicts'); EXIT mutation;
      END IF;
      new_source_entry := jsonb_build_object(
        'node_id', _target_node_id, 'direction', desired_direction, 'hidden', _desired_hidden
      ) || desired_metadata;
      new_target_entry := jsonb_build_object(
        'node_id', _source_node_id, 'direction', reverse_direction, 'hidden', _desired_hidden
      );
      source_connections := source_connections || jsonb_build_array(new_source_entry);
      target_connections := target_connections || jsonb_build_array(new_target_entry);
    ELSE
      IF source_count <> 1 OR target_count <> 1 THEN
        response := jsonb_build_object('ok', false, 'kind', 'not_an_ordinary_reciprocal_pair'); EXIT mutation;
      END IF;
      IF jsonb_typeof(source_entry) IS DISTINCT FROM 'object' OR jsonb_typeof(target_entry) IS DISTINCT FROM 'object'
         OR source_entry->>'node_id' IS DISTINCT FROM _target_node_id::text
         OR target_entry->>'node_id' IS DISTINCT FROM _source_node_id::text
         OR upper(coalesce(source_entry->>'direction', '')) NOT IN ('N','NE','E','SE','S','SW','W','NW')
         OR upper(coalesce(target_entry->>'direction', '')) NOT IN ('N','NE','E','SE','S','SW','W','NW')
         OR (source_entry ? 'hidden' AND jsonb_typeof(source_entry->'hidden') IS DISTINCT FROM 'boolean')
         OR (target_entry ? 'hidden' AND jsonb_typeof(target_entry->'hidden') IS DISTINCT FROM 'boolean')
         OR (source_entry ? 'label' AND jsonb_typeof(source_entry->'label') IS DISTINCT FROM 'string')
         OR (target_entry ? 'label' AND jsonb_typeof(target_entry->'label') IS DISTINCT FROM 'string')
         OR (source_entry ? 'locked' AND jsonb_typeof(source_entry->'locked') IS DISTINCT FROM 'boolean')
         OR (target_entry ? 'locked' AND jsonb_typeof(target_entry->'locked') IS DISTINCT FROM 'boolean')
         OR (source_entry ? 'lock_key' AND jsonb_typeof(source_entry->'lock_key') IS DISTINCT FROM 'string')
         OR (target_entry ? 'lock_key' AND jsonb_typeof(target_entry->'lock_key') IS DISTINCT FROM 'string')
         OR (source_entry ? 'lock_hint' AND jsonb_typeof(source_entry->'lock_hint') IS DISTINCT FROM 'string')
         OR (target_entry ? 'lock_hint' AND jsonb_typeof(target_entry->'lock_hint') IS DISTINCT FROM 'string')
      THEN
        response := jsonb_build_object('ok', false, 'kind', 'malformed_connection_state'); EXIT mutation;
      END IF;
      current_reverse := CASE upper(source_entry->>'direction')
        WHEN 'N' THEN 'S' WHEN 'S' THEN 'N' WHEN 'E' THEN 'W' WHEN 'W' THEN 'E'
        WHEN 'NE' THEN 'SW' WHEN 'SW' THEN 'NE' WHEN 'NW' THEN 'SE' WHEN 'SE' THEN 'NW'
      END;
      IF current_reverse IS DISTINCT FROM upper(target_entry->>'direction')
         OR coalesce((source_entry->>'hidden')::boolean, false)
            IS DISTINCT FROM coalesce((target_entry->>'hidden')::boolean, false) THEN
        response := jsonb_build_object('ok', false, 'kind', 'conflicting_reciprocal_state'); EXIT mutation;
      END IF;
      IF source_entry <> expected_source OR target_entry <> expected_target THEN
        response := jsonb_build_object('ok', false, 'kind', 'stale_connection_state'); EXIT mutation;
      END IF;

      IF op = 'remove' THEN
        SELECT coalesce(jsonb_agg(value ORDER BY ord), '[]'::jsonb) INTO source_connections
        FROM jsonb_array_elements(source_connections) WITH ORDINALITY AS entry(value, ord)
        WHERE ord <> source_position;
        SELECT coalesce(jsonb_agg(value ORDER BY ord), '[]'::jsonb) INTO target_connections
        FROM jsonb_array_elements(target_connections) WITH ORDINALITY AS entry(value, ord)
        WHERE ord <> target_position;
      ELSE
        new_source_entry := (source_entry - 'label' - 'locked' - 'lock_key' - 'lock_hint')
          || desired_metadata
          || jsonb_build_object('node_id', _target_node_id, 'direction', desired_direction, 'hidden', _desired_hidden);
        new_target_entry := target_entry
          || jsonb_build_object('node_id', _source_node_id, 'direction', reverse_direction, 'hidden', _desired_hidden);
        SELECT jsonb_agg(CASE WHEN ord = source_position THEN new_source_entry ELSE value END ORDER BY ord)
          INTO source_connections
        FROM jsonb_array_elements(source_connections) WITH ORDINALITY AS entry(value, ord);
        SELECT jsonb_agg(CASE WHEN ord = target_position THEN new_target_entry ELSE value END ORDER BY ord)
          INTO target_connections
        FROM jsonb_array_elements(target_connections) WITH ORDINALITY AS entry(value, ord);
      END IF;
    END IF;

    UPDATE public.nodes SET connections = source_connections WHERE id = _source_node_id;
    UPDATE public.nodes SET connections = target_connections WHERE id = _target_node_id;
    response := jsonb_build_object(
      'ok', true,
      'kind', CASE op WHEN 'create' THEN 'created' WHEN 'edit' THEN 'edited' ELSE 'removed' END,
      'source_node_id', _source_node_id,
      'target_node_id', _target_node_id,
      'replayed', false
    );
  END mutation;

  UPDATE public.admin_node_connection_request SET result = response WHERE request_id = _request_id;
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mutate_reciprocal_node_connection(uuid,text,uuid,uuid,jsonb,jsonb,text,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mutate_reciprocal_node_connection(uuid,text,uuid,uuid,jsonb,jsonb,text,boolean,jsonb) TO authenticated;