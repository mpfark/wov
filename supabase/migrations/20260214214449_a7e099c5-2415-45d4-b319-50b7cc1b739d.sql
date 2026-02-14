
-- Activity log for tracking player events
CREATE TABLE public.activity_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  character_id uuid REFERENCES public.characters(id) ON DELETE SET NULL,
  event_type text NOT NULL DEFAULT 'general',
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for fast lookups by user
CREATE INDEX idx_activity_log_user_id ON public.activity_log(user_id);
CREATE INDEX idx_activity_log_created_at ON public.activity_log(created_at DESC);

-- Enable RLS
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- Admins can view all logs
CREATE POLICY "Admins can view activity logs"
  ON public.activity_log FOR SELECT
  USING (is_maiar_or_valar());

-- Users can view own logs
CREATE POLICY "Users can view own activity logs"
  ON public.activity_log FOR SELECT
  USING (auth.uid() = user_id);

-- Authenticated users can insert own logs
CREATE POLICY "Users can insert own activity logs"
  ON public.activity_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admins can insert any logs (for edge function actions)
CREATE POLICY "Admins can insert activity logs"
  ON public.activity_log FOR INSERT
  WITH CHECK (is_maiar_or_valar());

-- Auto-trim old logs per user (keep last 200)
CREATE OR REPLACE FUNCTION public.trim_activity_log()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.activity_log
  WHERE id IN (
    SELECT id FROM public.activity_log
    WHERE user_id = NEW.user_id
    ORDER BY created_at DESC
    OFFSET 200
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trim_activity_log_trigger
  AFTER INSERT ON public.activity_log
  FOR EACH ROW
  EXECUTE FUNCTION public.trim_activity_log();

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
