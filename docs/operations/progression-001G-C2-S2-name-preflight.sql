-- READ-ONLY, prepared locally; not executed against hosted data.
-- Run in one read-only transaction under authorized metadata/read access.
BEGIN TRANSACTION READ ONLY;
SELECT version() AS postgres_version, current_setting('server_encoding') AS encoding,
  d.datcollate, d.datctype, d.datcollversion,
  pg_database_collation_actual_version(d.oid) AS actual_database_collation_version
FROM pg_database d WHERE d.datname = current_database();
SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type,
  a.attnotnull, a.attcollation::regcollation AS input_collation,
  c.collprovider, c.collisdeterministic, c.collversion,
  pg_collation_actual_version(c.oid) AS actual_version
FROM pg_attribute a JOIN pg_collation c ON c.oid = a.attcollation
WHERE a.attrelid = 'public.characters'::regclass AND a.attname = 'name' AND NOT a.attisdropped;

-- pg_attribute's regcollation below supplies only a quoted catalog identifier.
-- Copy that identifier into the single marker; never assume lower uses final C.
-- Do not execute with the marker unresolved. No player names are returned.
WITH cases(label,a,b,required_expected) AS (VALUES
  ('ASCII','Eldrin','ELDRIN',true), ('accent distinct','Eldrin','Éldrin',false),
  ('accent case','Éldrin','ÉLDRIN',true), ('AE','Æ','æ',true),
  ('O slash','Ø','ø',true), ('A ring','Å','å',true),
  ('edge U+0020',' Eldrin ','ELDRIN',true),
  ('dotted I','İ','i',NULL::boolean), ('dotless I','I','ı',NULL::boolean),
  ('sigma','Σ','ς',NULL::boolean), ('sharp S','ß','SS',NULL::boolean),
  ('composed/decomposed','É',U&'E\0301',NULL::boolean),
  ('space only','   ','',NULL::boolean)
)
SELECT label, required_expected,
  ((lower(btrim(a COLLATE __ACTUAL_NAME_COLLATION__))) COLLATE "C" =
   (lower(btrim(b COLLATE __ACTUAL_NAME_COLLATION__))) COLLATE "C") AS actual_equal
FROM cases;

SELECT count(*) AS character_count,
  count(*) FILTER (WHERE name IS NULL) AS null_names,
  count(*) FILTER (WHERE name IS NOT NULL AND btrim(name) = '') AS blank_names
FROM public.characters;
WITH collisions AS (
  SELECT count(*) AS members FROM public.characters
  GROUP BY ((lower(btrim(name))) COLLATE "C") HAVING count(*) > 1
)
SELECT count(*) AS collision_groups, coalesce(sum(members),0) AS affected_rows,
  coalesce(max(members),0) AS largest_group FROM collisions;
SELECT i.indexrelid::regclass AS index_name, i.indisunique, i.indisvalid,
  i.indisready, pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i WHERE i.indrelid = 'public.characters'::regclass;
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = 'public.characters'::regclass AND contype IN ('p','u','c');
SELECT to_regclass('public.characters_creation_name_key_uq') AS proposed_name_already_used;
COMMIT;
