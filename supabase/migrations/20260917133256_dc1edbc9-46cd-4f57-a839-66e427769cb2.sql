-- Atomic loot-table save/delete. Entry order is non-authored; compare by stable entry UUID.
-- Lock order: request, table, entries, items, creatures, deterministic writes.
CREATE TABLE public.admin_loot_table_request (
  request_id uuid PRIMARY KEY, caller_id uuid NOT NULL, operation text NOT NULL,
  loot_table_id uuid, expected_table jsonb, expected_entries jsonb NOT NULL,
  expected_creature_ids jsonb NOT NULL, desired_name text,
  desired_entries jsonb NOT NULL, result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.admin_loot_table_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_loot_table_request FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.admin_loot_table_request FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_mutate_loot_table(
  _request_id uuid, _operation text, _loot_table_id uuid, _expected_table jsonb,
  _expected_entries jsonb, _expected_creature_ids jsonb, _desired_name text,
  _desired_entries jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  caller uuid := auth.uid(); op text := lower(btrim(coalesce(_operation, '')));
  prior public.admin_loot_table_request%ROWTYPE; table_row public.loot_tables%ROWTYPE;
  actual_table jsonb; actual_entries jsonb; actual_creatures jsonb; response jsonb;
  new_table_id uuid; entry jsonb; new_entry_id uuid; item_ids uuid[];
  reference_count integer := 0; written_count integer := 0;
BEGIN
  IF caller IS NULL THEN RETURN jsonb_build_object('ok', false, 'kind', 'not_authenticated'); END IF;
  IF NOT public.is_steward_or_overlord() THEN RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized'); END IF;
  IF _request_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request'); END IF;

  INSERT INTO public.admin_loot_table_request (
    request_id, caller_id, operation, loot_table_id, expected_table,
    expected_entries, expected_creature_ids, desired_name, desired_entries
  ) VALUES (
    _request_id, caller, op, _loot_table_id, _expected_table,
    _expected_entries, _expected_creature_ids, _desired_name, _desired_entries
  ) ON CONFLICT (request_id) DO NOTHING;
  SELECT * INTO prior FROM public.admin_loot_table_request
  WHERE request_id = _request_id FOR UPDATE;
  IF prior.caller_id IS DISTINCT FROM caller OR prior.operation IS DISTINCT FROM op
    OR prior.loot_table_id IS DISTINCT FROM _loot_table_id
    OR prior.expected_table IS DISTINCT FROM _expected_table
    OR prior.expected_entries IS DISTINCT FROM _expected_entries
    OR prior.expected_creature_ids IS DISTINCT FROM _expected_creature_ids
    OR prior.desired_name IS DISTINCT FROM _desired_name
    OR prior.desired_entries IS DISTINCT FROM _desired_entries
  THEN RETURN jsonb_build_object('ok', false, 'kind', 'request_conflict'); END IF;
  IF prior.result IS NOT NULL THEN RETURN prior.result || jsonb_build_object('replayed', true); END IF;

  IF op NOT IN ('save', 'delete') THEN
    response := jsonb_build_object('ok', false, 'kind', 'unsupported_operation');
  ELSIF jsonb_typeof(_expected_entries) IS DISTINCT FROM 'array'
    OR jsonb_typeof(_expected_creature_ids) IS DISTINCT FROM 'array'
    OR jsonb_typeof(_desired_entries) IS DISTINCT FROM 'array'
    OR jsonb_array_length(_expected_entries) > 200
    OR jsonb_array_length(_desired_entries) > 200 THEN
    response := jsonb_build_object('ok', false, 'kind', 'invalid_request');
  ELSIF op = 'save' AND (_desired_name IS NULL OR btrim(_desired_name) = '') THEN
    response := jsonb_build_object('ok', false, 'kind', 'invalid_request');
  ELSIF op = 'delete' AND (
    _loot_table_id IS NULL OR _desired_name IS NOT NULL OR _desired_entries <> '[]'::jsonb
  ) THEN response := jsonb_build_object('ok', false, 'kind', 'invalid_request');
  END IF;

  IF response IS NULL AND _expected_table IS NOT NULL AND (
    jsonb_typeof(_expected_table) IS DISTINCT FROM 'object'
    OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(_expected_table) key)
      <> ARRAY['id', 'name']::text[]
    OR jsonb_typeof(_expected_table->'id') IS DISTINCT FROM 'string'
    OR (_expected_table->>'id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR jsonb_typeof(_expected_table->'name') IS DISTINCT FROM 'string'
  ) THEN response := jsonb_build_object('ok', false, 'kind', 'invalid_request'); END IF;

  IF response IS NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(_expected_entries) value
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key)
        <> ARRAY['id', 'item_id', 'weight']::text[]
      OR jsonb_typeof(value->'id') IS DISTINCT FROM 'string'
      OR (value->>'id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      OR jsonb_typeof(value->'item_id') IS DISTINCT FROM 'string'
      OR (value->>'item_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      OR jsonb_typeof(value->'weight') IS DISTINCT FROM 'number'
      OR (value->>'weight')::numeric <> trunc((value->>'weight')::numeric)
      OR (value->>'weight')::numeric NOT BETWEEN 1 AND 100
  ) THEN response := jsonb_build_object('ok', false, 'kind', 'invalid_request'); END IF;

  IF response IS NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(_expected_creature_ids) value
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
      OR trim(both '"' from value::text) !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  ) THEN response := jsonb_build_object('ok', false, 'kind', 'invalid_request'); END IF;

  IF response IS NULL AND (
    (SELECT count(*) FROM jsonb_array_elements(_expected_entries))
      <> (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(_expected_entries) value)
    OR (SELECT count(*) FROM jsonb_array_elements(_expected_creature_ids))
      <> (SELECT count(DISTINCT value) FROM jsonb_array_elements(_expected_creature_ids) value)
  ) THEN response := jsonb_build_object('ok', false, 'kind', 'invalid_request'); END IF;

  IF response IS NULL AND op = 'save' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(_desired_entries) value
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key)
        <> ARRAY['entry_id', 'item_id', 'weight']::text[]
      OR jsonb_typeof(value->'item_id') IS DISTINCT FROM 'string'
      OR (value->>'item_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      OR jsonb_typeof(value->'weight') IS DISTINCT FROM 'number'
      OR (value->>'weight')::numeric <> trunc((value->>'weight')::numeric)
      OR (value->>'weight')::numeric NOT BETWEEN 1 AND 100
      OR (value->'entry_id' <> 'null'::jsonb AND (
        jsonb_typeof(value->'entry_id') IS DISTINCT FROM 'string'
        OR (value->>'entry_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      ))
  ) THEN response := jsonb_build_object('ok', false, 'kind', 'invalid_request'); END IF;

  IF response IS NULL AND op = 'save' AND
    (SELECT count(*) FROM jsonb_array_elements(_desired_entries) value
      WHERE value->'entry_id' <> 'null'::jsonb)
    <> (SELECT count(DISTINCT value->>'entry_id') FROM jsonb_array_elements(_desired_entries) value
      WHERE value->'entry_id' <> 'null'::jsonb)
  THEN response := jsonb_build_object('ok', false, 'kind', 'duplicate_entry'); END IF;

  IF response IS NULL AND _loot_table_id IS NULL THEN
    IF _expected_table IS NOT NULL OR _expected_entries <> '[]'::jsonb
      OR _expected_creature_ids <> '[]'::jsonb OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(_desired_entries) value
        WHERE value->'entry_id' <> 'null'::jsonb
      )
    THEN response := jsonb_build_object('ok', false, 'kind', 'invalid_request'); END IF;
  ELSIF response IS NULL AND (
    _expected_table IS NULL OR (_expected_table->>'id')::uuid IS DISTINCT FROM _loot_table_id
  ) THEN response := jsonb_build_object('ok', false, 'kind', 'invalid_request');
  END IF;

  IF response IS NULL AND _loot_table_id IS NOT NULL THEN
    SELECT * INTO table_row FROM public.loot_tables WHERE id = _loot_table_id FOR UPDATE;
    IF NOT FOUND THEN response := jsonb_build_object('ok', false, 'kind', 'loot_table_not_found');
    ELSE
      actual_table := jsonb_build_object('id', table_row.id, 'name', table_row.name);
      PERFORM id FROM public.loot_table_entries
      WHERE loot_table_id = _loot_table_id ORDER BY id FOR UPDATE;
      SELECT coalesce(jsonb_agg(
        jsonb_build_object('id', id, 'item_id', item_id, 'weight', weight) ORDER BY id
      ), '[]') INTO actual_entries FROM public.loot_table_entries
      WHERE loot_table_id = _loot_table_id;
      IF actual_table <> _expected_table OR actual_entries <> _expected_entries THEN
        response := jsonb_build_object('ok', false, 'kind', 'stale_loot_table_state');
      END IF;
    END IF;
  END IF;

  IF response IS NULL AND op = 'save' THEN
    SELECT array_agg(DISTINCT (value->>'item_id')::uuid ORDER BY (value->>'item_id')::uuid)
    INTO item_ids FROM jsonb_array_elements(_desired_entries) value;
    IF item_ids IS NOT NULL THEN
      PERFORM id FROM public.items WHERE id = ANY(item_ids) ORDER BY id FOR KEY SHARE;
      IF (SELECT count(*) FROM public.items WHERE id = ANY(item_ids)) <> cardinality(item_ids) THEN
        response := jsonb_build_object('ok', false, 'kind', 'item_not_found');
      END IF;
    END IF;
    IF response IS NULL AND _loot_table_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(_desired_entries) value
      WHERE value->'entry_id' <> 'null'::jsonb AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(_expected_entries) expected
        WHERE expected->>'id' = value->>'entry_id'
      )
    ) THEN response := jsonb_build_object('ok', false, 'kind', 'entry_not_found'); END IF;
  END IF;

  IF response IS NULL AND _loot_table_id IS NOT NULL THEN
    PERFORM id FROM public.creatures
    WHERE loot_table_id = _loot_table_id ORDER BY id FOR UPDATE;
    SELECT coalesce(jsonb_agg(id ORDER BY id), '[]'), count(*)
    INTO actual_creatures, reference_count FROM public.creatures
    WHERE loot_table_id = _loot_table_id;
    IF actual_creatures <> _expected_creature_ids THEN
      response := jsonb_build_object('ok', false, 'kind', 'stale_loot_table_state');
    ELSIF op = 'delete' AND reference_count > 0 THEN
      response := jsonb_build_object(
        'ok', false, 'kind', 'table_in_use', 'reference_count', reference_count
      );
    END IF;
  END IF;

  IF response IS NULL THEN
    BEGIN
      IF op = 'delete' THEN
        DELETE FROM public.loot_tables WHERE id = _loot_table_id;
        response := jsonb_build_object(
          'ok', true, 'kind', 'deleted', 'loot_table_id', _loot_table_id,
          'entry_count', 0, 'replayed', false
        );
      ELSE
        IF _loot_table_id IS NULL THEN
          INSERT INTO public.loot_tables (name) VALUES (btrim(_desired_name))
          RETURNING id INTO new_table_id;
        ELSE
          new_table_id := _loot_table_id;
          UPDATE public.loot_tables SET name = btrim(_desired_name) WHERE id = new_table_id;
        END IF;
        DELETE FROM public.loot_table_entries WHERE loot_table_id = new_table_id;
        FOR entry IN SELECT value FROM jsonb_array_elements(_desired_entries)
          ORDER BY coalesce(value->>'entry_id', ''), value->>'item_id'
        LOOP
          new_entry_id := CASE WHEN entry->'entry_id' = 'null'::jsonb
            THEN gen_random_uuid() ELSE (entry->>'entry_id')::uuid END;
          INSERT INTO public.loot_table_entries (id, loot_table_id, item_id, weight)
          VALUES (new_entry_id, new_table_id, (entry->>'item_id')::uuid, (entry->>'weight')::integer);
          written_count := written_count + 1;
        END LOOP;
        response := jsonb_build_object(
          'ok', true, 'kind', CASE WHEN _loot_table_id IS NULL THEN 'created' ELSE 'updated' END,
          'loot_table_id', new_table_id, 'entry_count', written_count, 'replayed', false
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      response := jsonb_build_object('ok', false, 'kind', 'database_error');
    END;
  END IF;
  UPDATE public.admin_loot_table_request SET result = response WHERE request_id = _request_id;
  RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_mutate_loot_table(uuid, text, uuid, jsonb, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mutate_loot_table(uuid, text, uuid, jsonb, jsonb, jsonb, text, jsonb) TO authenticated;