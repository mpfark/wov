
-- Create party combat log table
CREATE TABLE public.party_combat_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.party_combat_log ENABLE ROW LEVEL SECURITY;

-- Party members can view their party's logs
CREATE POLICY "Party members can view combat log"
  ON public.party_combat_log FOR SELECT
  TO authenticated
  USING (is_party_member(party_id));

-- Any party member can insert logs for their party
CREATE POLICY "Party members can insert combat log"
  ON public.party_combat_log FOR INSERT
  TO authenticated
  WITH CHECK (is_party_member(party_id));

-- Allow delete for cleanup (leader or system)
CREATE POLICY "Party members can delete combat log"
  ON public.party_combat_log FOR DELETE
  TO authenticated
  USING (is_party_member(party_id));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.party_combat_log;

-- Auto-cleanup: keep only last 50 entries per party via a trigger
CREATE OR REPLACE FUNCTION public.trim_party_combat_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.party_combat_log
  WHERE id IN (
    SELECT id FROM public.party_combat_log
    WHERE party_id = NEW.party_id
    ORDER BY created_at DESC
    OFFSET 50
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trim_party_combat_log_trigger
  AFTER INSERT ON public.party_combat_log
  FOR EACH ROW
  EXECUTE FUNCTION public.trim_party_combat_log();
