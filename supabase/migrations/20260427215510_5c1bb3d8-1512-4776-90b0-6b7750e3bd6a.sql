
-- Revoke EXECUTE from anon on ALL public SECURITY DEFINER functions.
-- Internal auth checks already reject anon callers; this silences the linter
-- and removes redundant exposure.

DO $$
DECLARE
  _fn record;
BEGIN
  FOR _fn IN
    SELECT n.nspname AS schema_name,
           p.proname AS func_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, PUBLIC',
                   _fn.func_name, _fn.args);
  END LOOP;
END $$;

-- Also revoke EXECUTE from `authenticated` on functions that should only run
-- via service role / triggers / cron. Signed-in users have no reason to call
-- these directly.

REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.damage_creature(uuid, integer, boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_marketplace_listings() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.regen_creature_hp() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.respawn_creatures() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_ground_loot() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.return_unique_items() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trim_activity_log() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trim_party_combat_log() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.restrict_party_leader_updates() FROM authenticated;
