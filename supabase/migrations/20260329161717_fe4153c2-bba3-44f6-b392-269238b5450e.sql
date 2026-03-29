
-- Create a SECURITY DEFINER RPC for logging activity
CREATE OR REPLACE FUNCTION public.log_activity(
  _character_id uuid,
  _event_type text,
  _message text,
  _metadata jsonb DEFAULT '{}'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _event_type NOT IN ('combat_kill', 'loot_drop', 'level_up', 'general', 'login', 'logout', 'death', 'trade', 'craft', 'move', 'party', 'whisper') THEN
    RAISE EXCEPTION 'Invalid event_type';
  END IF;
  INSERT INTO activity_log (user_id, character_id, event_type, message, metadata)
  VALUES (auth.uid(), _character_id, _event_type, _message, _metadata);
END;
$$;

-- Drop the permissive user insert policy
DROP POLICY "Users can insert own activity logs" ON activity_log;
