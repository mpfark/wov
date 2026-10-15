WITH bindings AS (
 SELECT t.tgname AS name, t.tgenabled AS enabled,
        t.tgfoid::regprocedure::text AS function_identity,
        pg_get_triggerdef(t.oid,true) AS definition,
        t.tgdeferrable AS deferrable, t.tginitdeferred AS initially_deferred,
        t.tgconstraint<>0 AS constraint_trigger,
        CASE WHEN t.tgconstraint<>0 THEN pg_get_constraintdef(t.tgconstraint,true)
          END AS constraint_definition
 FROM pg_trigger t
 WHERE t.tgrelid=to_regclass('public.characters')
   AND NOT t.tgisinternal AND (t.tgtype::integer & 16)<>0
)
SELECT jsonb_build_object(
 'observed_at',statement_timestamp(), 'role',current_user,
 'characters_present',to_regclass('public.characters') IS NOT NULL,
 'triggers',(SELECT jsonb_agg(to_jsonb(b) ORDER BY name) FROM bindings b)
) AS contract_character_bindings;
