-- REVIEWED INPUT ONLY: standard Lovable tool owns later migration registration.
-- Execute atomically in one transaction. No CONCURRENTLY, IF NOT EXISTS or data repair.
-- SHARE lock keeps the preflight stable and blocks name writes until index commit.
LOCK TABLE public.characters IN SHARE MODE;

DO $preflight$
DECLARE
  name_collation regcollation;
  deterministic boolean;
  comparisons_ok boolean;
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'S2 requires verified UTF8 name semantics';
  END IF;
  SELECT a.attcollation::regcollation, c.collisdeterministic
    INTO name_collation, deterministic
    FROM pg_attribute a JOIN pg_collation c ON c.oid = a.attcollation
    WHERE a.attrelid = 'public.characters'::regclass
      AND a.attname = 'name' AND NOT a.attisdropped;
  IF name_collation IS NULL OR deterministic IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'S2 name column/collation requires review';
  END IF;
  -- Use the actual column input collation for lower; final comparison is bytewise C.
  EXECUTE format($probe$
    SELECT bool_and(((lower(btrim(a COLLATE %1$s))) COLLATE "C" =
                      (lower(btrim(b COLLATE %1$s))) COLLATE "C") = expected)
    FROM (VALUES ('Eldrin','ELDRIN',true), ('Eldrin','Éldrin',false),
      ('Éldrin','ÉLDRIN',true), ('Æ','æ',true), ('Ø','ø',true),
      ('Å','å',true), (' Eldrin ','ELDRIN',true)) AS cases(a,b,expected)
  $probe$, name_collation) INTO comparisons_ok;
  IF comparisons_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'S2 required case/accent comparisons failed; no fallback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.characters WHERE name IS NULL OR btrim(name) = '') THEN
    RAISE EXCEPTION 'S2 existing null/blank names require owner review';
  END IF;
  IF EXISTS (SELECT 1 FROM public.characters
    GROUP BY ((lower(btrim(name))) COLLATE "C") HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'S2 existing name collisions require owner resolution';
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX characters_creation_name_key_uq
  ON public.characters (((lower(btrim(name))) COLLATE "C"));
-- No new tables/functions/triggers/privileges; existing RLS and grants stay unchanged.
