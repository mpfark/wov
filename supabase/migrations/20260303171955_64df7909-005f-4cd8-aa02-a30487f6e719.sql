CREATE TABLE public.issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  character_id uuid REFERENCES public.characters(id) ON DELETE SET NULL,
  character_name text NOT NULL DEFAULT '',
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.issue_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own reports"
  ON public.issue_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own reports"
  ON public.issue_reports FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR is_steward_or_overlord());

CREATE POLICY "Admins can update reports"
  ON public.issue_reports FOR UPDATE TO authenticated
  USING (is_steward_or_overlord());

CREATE POLICY "Admins can delete reports"
  ON public.issue_reports FOR DELETE TO authenticated
  USING (is_steward_or_overlord());