
-- Create summon_requests table
CREATE TABLE public.summon_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summoner_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  summoner_node_id uuid NOT NULL REFERENCES public.nodes(id),
  cp_cost integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 seconds')
);

-- Enable RLS
ALTER TABLE public.summon_requests ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own summon requests"
  ON public.summon_requests FOR SELECT
  TO authenticated
  USING (owns_character(summoner_id) OR owns_character(target_id));

CREATE POLICY "Users can create summon requests"
  ON public.summon_requests FOR INSERT
  TO authenticated
  WITH CHECK (owns_character(summoner_id));

CREATE POLICY "Target can update summon requests"
  ON public.summon_requests FOR UPDATE
  TO authenticated
  USING (owns_character(target_id));

CREATE POLICY "Summoner can delete own requests"
  ON public.summon_requests FOR DELETE
  TO authenticated
  USING (owns_character(summoner_id) OR owns_character(target_id));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.summon_requests;

-- Accept summon RPC
CREATE OR REPLACE FUNCTION public.accept_summon(_request_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _req RECORD;
  _summoner RECORD;
BEGIN
  -- Fetch the request
  SELECT * INTO _req FROM summon_requests WHERE id = _request_id AND status = 'pending';
  IF _req IS NULL THEN
    RAISE EXCEPTION 'Summon request not found or already handled';
  END IF;

  -- Verify caller is the target
  IF NOT owns_character(_req.target_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Check not expired
  IF _req.expires_at < now() THEN
    DELETE FROM summon_requests WHERE id = _request_id;
    RAISE EXCEPTION 'Summon request has expired';
  END IF;

  -- Check target is not in combat
  IF EXISTS (
    SELECT 1 FROM combat_sessions
    WHERE character_id = _req.target_id
       OR (party_id IN (SELECT party_id FROM party_members WHERE character_id = _req.target_id AND status = 'accepted'))
  ) THEN
    RAISE EXCEPTION 'Cannot accept summon while in combat';
  END IF;

  -- Check summoner has enough CP
  SELECT cp INTO _summoner FROM characters WHERE id = _req.summoner_id;
  IF _summoner.cp < _req.cp_cost THEN
    DELETE FROM summon_requests WHERE id = _request_id;
    RAISE EXCEPTION 'Summoner no longer has enough CP';
  END IF;

  -- Deduct CP from summoner
  UPDATE characters SET cp = cp - _req.cp_cost WHERE id = _req.summoner_id;

  -- Move target to summoner's node
  UPDATE characters SET current_node_id = _req.summoner_node_id WHERE id = _req.target_id;

  -- Delete the request
  DELETE FROM summon_requests WHERE id = _request_id;
END;
$$;

-- Decline summon RPC
CREATE OR REPLACE FUNCTION public.decline_summon(_request_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Verify caller is the target
  IF NOT EXISTS (
    SELECT 1 FROM summon_requests WHERE id = _request_id AND owns_character(target_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM summon_requests WHERE id = _request_id;
END;
$$;
