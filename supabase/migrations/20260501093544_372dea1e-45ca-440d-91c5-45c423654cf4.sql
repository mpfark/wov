-- ─────────────────────────────────────────────────────────────────────────────
-- De-duplicate node connections
--
-- Some nodes had the same connection entry (same node_id + direction) listed
-- multiple times in the `connections` jsonb array. This confused movement
-- routing because the UI keys exits by direction. Collapse duplicates to a
-- single entry per (node_id, direction) pair, preserving the first label.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.nodes n
SET connections = sub.deduped
FROM (
  SELECT
    n2.id,
    COALESCE(
      jsonb_agg(DISTINCT_CONN ORDER BY DISTINCT_CONN->>'direction'),
      '[]'::jsonb
    ) AS deduped
  FROM public.nodes n2,
  LATERAL (
    SELECT DISTINCT ON (
      upper(c->>'direction'),
      c->>'node_id'
    )
      jsonb_build_object(
        'node_id',   c->>'node_id',
        'direction', upper(c->>'direction'),
        'label',     COALESCE(c->>'label', '')
      ) AS DISTINCT_CONN
    FROM jsonb_array_elements(n2.connections) c
    WHERE c ? 'node_id' AND c ? 'direction'
    ORDER BY
      upper(c->>'direction'),
      c->>'node_id',
      -- Prefer entries that have a non-empty label
      (CASE WHEN COALESCE(c->>'label','') = '' THEN 1 ELSE 0 END)
  ) DISTINCT_CONN
  GROUP BY n2.id
) sub
WHERE n.id = sub.id
  AND n.connections IS DISTINCT FROM sub.deduped;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: prevent future duplicates from being persisted
-- Normalizes each connection on write: uppercases the direction and removes
-- duplicate (node_id, direction) entries, keeping the first non-empty label.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_node_connections()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
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
      jsonb_build_object(
        'node_id',   c->>'node_id',
        'direction', upper(c->>'direction'),
        'label',     COALESCE(c->>'label', '')
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
$$;

DROP TRIGGER IF EXISTS trg_normalize_node_connections ON public.nodes;
CREATE TRIGGER trg_normalize_node_connections
BEFORE INSERT OR UPDATE OF connections ON public.nodes
FOR EACH ROW
EXECUTE FUNCTION public.normalize_node_connections();