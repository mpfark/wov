-- LOCAL CANDIDATE ONLY. Caller isolation and installed parity are unresolved.
-- Future installation: separately authorized standard Lovable Drizzle channel only.
-- No cron invocation, privilege change or lifecycle execution in this artifact.
BEGIN;
DO $patch$
DECLARE
 target oid := to_regprocedure('public.idle_shutdown_check()');
 original text; patched text; definition text; metadata jsonb;
 addition text := E' PERFORM pg_advisory_xact_lock(hashtext(''combat2-production-activation''));\n';
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'idle source missing'; END IF;
 SELECT replace(prosrc,E'\r\n',E'\n'),to_jsonb(p)-'prosrc'
 INTO original,metadata FROM pg_proc p WHERE oid=target;
 IF (encode(sha256(convert_to(original,'UTF8')),'hex')=
     '3c14b179b83d26da8b25cf50f1f568f0a137490b603e51b947c299c6a261604e'
     AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
       WHERE p.oid=target AND p.proowner='postgres'::regrole AND p.prosecdef
       AND p.provolatile='v' AND l.lanname='plpgsql' AND p.pronargs=0
       AND p.prorettype='void'::regtype AND NOT p.proretset
       AND p.proconfig=ARRAY['search_path=public, cron, pg_temp']::text[])) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'idle source/settings drift'; END IF;
 patched := replace(original,E'\nBEGIN\n',E'\nBEGIN\n'||addition);
 IF length(patched)-length(original)<>length(addition)
 THEN RAISE EXCEPTION 'idle patch cardinality'; END IF;
 SELECT pg_get_functiondef(target) INTO definition;
 -- Preserve the complete deparsed declaration, settings, owner and existing ACL.
 definition := replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=target),patched);
 EXECUTE definition;
 IF (SELECT prosrc=patched AND (to_jsonb(p)-'prosrc')=metadata FROM pg_proc p WHERE oid=target)
    IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'idle metadata/body preservation failed'; END IF;
END
$patch$;
COMMIT;
