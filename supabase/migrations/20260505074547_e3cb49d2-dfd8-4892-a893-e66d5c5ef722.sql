CREATE OR REPLACE FUNCTION public.normalize_node_connections()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _deduped jsonb;
BEGIN
  IF NEW.connections IS NULL OR jsonb_typeof(NEW.connections) <> 'array' THEN
    NEW.connections := '[]'::jsonb;
    RETURN NEW;
  END IF;

  SELECT COALESCE(jsonb_agg(entry ORDER BY entry->>'direction'), '[]'::jsonb)
  INTO _deduped
  FROM (
    SELECT DISTINCT ON (upper(c->>'direction'), c->>'node_id')
      (
        jsonb_build_object(
          'node_id',   c->>'node_id',
          'direction', upper(c->>'direction'),
          'label',     COALESCE(c->>'label', '')
        )
        || CASE WHEN (c ? 'hidden')    THEN jsonb_build_object('hidden',    (c->>'hidden')::boolean) ELSE '{}'::jsonb END
        || CASE WHEN (c ? 'locked')    THEN jsonb_build_object('locked',    (c->>'locked')::boolean) ELSE '{}'::jsonb END
        || CASE WHEN (c ? 'lock_key')  THEN jsonb_build_object('lock_key',  c->>'lock_key')          ELSE '{}'::jsonb END
        || CASE WHEN (c ? 'lock_hint') THEN jsonb_build_object('lock_hint', c->>'lock_hint')         ELSE '{}'::jsonb END
      ) AS entry
    FROM jsonb_array_elements(NEW.connections) c
    WHERE c ? 'node_id' AND c ? 'direction'
    ORDER BY
      upper(c->>'direction'),
      c->>'node_id',
      (CASE WHEN COALESCE(c->>'label','') = '' THEN 1 ELSE 0 END)
  ) s;

  NEW.connections := _deduped;
  RETURN NEW;
END;
$function$;