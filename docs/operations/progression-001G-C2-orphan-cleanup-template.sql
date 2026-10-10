-- INCOMPLETE REVIEW TEMPLATE: NOT authorized, NOT an installation input.
-- Deliberately fails without an individually reviewed/owner-approved203-row snapshot.
-- Separate future authorization and one transaction required; never add to C2 cutover.
-- Fill only explicit VALUES after complete-visibility inspection and owner disposition.
-- Do NOT populate this allowlist from an unreviewed anti-join or change expected count.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $principal$
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'postgres cleanup principal required'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN ('public.characters'::regclass,
    'public.character_materials'::regclass,'public.character_inventory'::regclass,
    'public.progression_character_state'::regclass,'public.character_creation_origin'::regclass,
    'public.character_creation_log'::regclass,'public.character_lifecycle_receipt'::regclass)
    AND row_security_active(c.oid))
  THEN RAISE EXCEPTION 'complete administrative visibility required'; END IF;
END $principal$;
CREATE TEMP TABLE c2_approved_orphan_materials (
  character_id uuid NOT NULL,material_key text NOT NULL,count integer NOT NULL,
  updated_at timestamptz NOT NULL,PRIMARY KEY(character_id,material_key)
) ON COMMIT DROP;
-- APPROVED_ROW_SNAPSHOT_REQUIRED: empty on purpose.
LOCK TABLE public.characters IN SHARE MODE;
LOCK TABLE public.character_materials IN SHARE ROW EXCLUSIVE MODE;
DO $cleanup$
DECLARE removed integer;
BEGIN
  IF (SELECT count(*) FROM pg_temp.c2_approved_orphan_materials)<>203
  THEN RAISE EXCEPTION 'explicit approved203-row snapshot required'; END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f'
      AND confrelid='public.character_materials'::regclass)
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.character_materials'::regclass
      AND NOT tgisinternal AND tgenabled<>'D')
  THEN RAISE EXCEPTION 'unexpected materials delete dependency or trigger'; END IF;
  IF EXISTS(SELECT 1 FROM pg_temp.c2_approved_orphan_materials a
    LEFT JOIN public.character_materials m USING(character_id,material_key)
    WHERE m.character_id IS NULL OR m.count IS DISTINCT FROM a.count
      OR m.updated_at IS DISTINCT FROM a.updated_at
      OR EXISTS(SELECT 1 FROM public.characters c WHERE c.id=a.character_id))
  THEN RAISE EXCEPTION 'approved orphan snapshot drift or live character'; END IF;
  IF EXISTS(SELECT 1 FROM pg_temp.c2_approved_orphan_materials a WHERE
    EXISTS(SELECT 1 FROM public.character_inventory i WHERE i.character_id=a.character_id)
    OR EXISTS(SELECT 1 FROM public.progression_character_state s WHERE s.character_id=a.character_id)
    OR EXISTS(SELECT 1 FROM public.character_creation_origin o WHERE o.character_id=a.character_id)
    OR EXISTS(SELECT 1 FROM public.character_creation_log l WHERE l.result_character_id=a.character_id)
    OR EXISTS(SELECT 1 FROM public.character_lifecycle_receipt r WHERE r.character_id=a.character_id))
  THEN RAISE EXCEPTION 'orphan recovery evidence requires separate owner resolution'; END IF;
  DELETE FROM public.character_materials m USING pg_temp.c2_approved_orphan_materials a
    WHERE m.character_id=a.character_id AND m.material_key=a.material_key
      AND m.count=a.count AND m.updated_at=a.updated_at
      AND NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=m.character_id);
  GET DIAGNOSTICS removed=ROW_COUNT;
  IF removed<>203 THEN RAISE EXCEPTION 'orphan cleanup row count drift'; END IF;
END $cleanup$;
-- No character, origin, receipt, material grant or lifecycle transition is changed.
-- Inspect installed triggers/FKs before any future use; template is not completeness proof.
