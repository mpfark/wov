
-- Batched activity logging. Accepts an array of entries; inserts them all
-- in a single statement so we cut the per-row RPC overhead for a high-volume
-- audit log. Mirrors log_activity()'s SECURITY DEFINER + auth.uid() check.
CREATE OR REPLACE FUNCTION public.log_activity_batch(_entries jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN;
  END IF;
  IF _entries IS NULL OR jsonb_typeof(_entries) <> 'array' THEN
    RETURN;
  END IF;

  INSERT INTO activity_log (user_id, character_id, event_type, message, metadata)
  SELECT
    uid,
    NULLIF(e->>'character_id','')::uuid,
    COALESCE(e->>'event_type','general'),
    COALESCE(e->>'message',''),
    COALESCE(e->'metadata','{}'::jsonb)
  FROM jsonb_array_elements(_entries) AS e
  WHERE COALESCE(e->>'event_type','general') IN (
    'combat_kill','loot_drop','level_up','general','login','logout','death',
    'trade','craft','move','party','whisper','teleport','combat_death','item_found'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_activity_batch(jsonb) TO authenticated;
