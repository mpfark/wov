
-- =====================================================
-- Families: founder model
-- =====================================================

CREATE TABLE public.families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  founder_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT families_key_format CHECK (key ~ '^[a-z]{2,20}$'),
  CONSTRAINT families_display_format CHECK (display_name ~ '^[A-Za-z]{2,20}$')
);
GRANT SELECT ON public.families TO authenticated, anon;
GRANT ALL ON public.families TO service_role;
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view families" ON public.families FOR SELECT USING (true);
-- writes go through SECURITY DEFINER RPCs

CREATE INDEX idx_families_founder ON public.families(founder_user_id);

CREATE TABLE public.family_members (
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id)
);
GRANT SELECT ON public.family_members TO authenticated;
GRANT ALL ON public.family_members TO service_role;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members and founder can see memberships" ON public.family_members
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.founder_user_id = auth.uid())
  );

CREATE INDEX idx_family_members_user ON public.family_members(user_id);

CREATE TABLE public.family_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  requester_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','denied','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
GRANT SELECT ON public.family_requests TO authenticated;
GRANT ALL ON public.family_requests TO service_role;
ALTER TABLE public.family_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Requester and founder can see requests" ON public.family_requests
  FOR SELECT TO authenticated USING (
    requester_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.families f WHERE f.id = family_id AND f.founder_user_id = auth.uid())
  );

CREATE UNIQUE INDEX uq_family_requests_pending
  ON public.family_requests(family_id, requester_user_id)
  WHERE status = 'pending';

-- =====================================================
-- Characters: family columns
-- =====================================================
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS family_name TEXT,
  ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES public.families(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS family_changed_after_creation BOOLEAN NOT NULL DEFAULT false;

-- =====================================================
-- Nodes: heraldry flag + NPC service_role
-- =====================================================
ALTER TABLE public.nodes
  ADD COLUMN IF NOT EXISTS is_heraldry BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.npcs DROP CONSTRAINT IF EXISTS npcs_service_role_check;
ALTER TABLE public.npcs ADD CONSTRAINT npcs_service_role_check
  CHECK (service_role IS NULL OR service_role = ANY (ARRAY[
    'vendor','blacksmith','trainer','jewelcrafter','recruiter','heraldry'
  ]));

-- =====================================================
-- Reserved / banned family names
-- =====================================================
CREATE OR REPLACE FUNCTION public._family_name_is_reserved(_key TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = public AS $$
  SELECT _key = ANY (ARRAY[
    'king','queen','prince','princess','emperor','empress',
    'lord','lady','god','goddess','admin','overlord','steward','gm'
  ])
$$;

-- =====================================================
-- check_family_name(_display)
-- =====================================================
CREATE OR REPLACE FUNCTION public.check_family_name(_display TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _key TEXT;
  _family public.families%ROWTYPE;
  _is_member BOOLEAN;
  _has_pending BOOLEAN;
  _founder_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _display IS NULL OR _display !~ '^[A-Za-z]{2,20}$' THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  _key := lower(_display);
  IF public._family_name_is_reserved(_key) THEN
    RETURN jsonb_build_object('status','reserved');
  END IF;

  SELECT * INTO _family FROM public.families WHERE key = _key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','available');
  END IF;

  IF _family.founder_user_id = auth.uid() THEN
    RETURN jsonb_build_object('status','founder','display_name',_family.display_name);
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.family_members
    WHERE family_id = _family.id AND user_id = auth.uid()
  ) INTO _is_member;
  IF _is_member THEN
    RETURN jsonb_build_object('status','member','display_name',_family.display_name);
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.family_requests
    WHERE family_id = _family.id AND requester_user_id = auth.uid() AND status = 'pending'
  ) INTO _has_pending;

  -- look up founder profile name for display
  SELECT COALESCE(p.full_name, 'another wayfarer')
    INTO _founder_email
    FROM public.profiles p WHERE p.user_id = _family.founder_user_id;

  RETURN jsonb_build_object(
    'status', CASE WHEN _has_pending THEN 'request_pending' ELSE 'needs_request' END,
    'display_name', _family.display_name,
    'founder_display_name', COALESCE(_founder_email, 'another wayfarer')
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_family_name(TEXT) TO authenticated;

-- =====================================================
-- apply_family_to_character(_character_id, _display)
-- =====================================================
CREATE OR REPLACE FUNCTION public.apply_family_to_character(
  _character_id UUID,
  _display TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _key TEXT;
  _family_id UUID;
  _family_display TEXT;
  _founder UUID;
  _is_member BOOLEAN;
  _char RECORD;
  _hash BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, user_id, family_name, family_changed_after_creation
    INTO _char
    FROM public.characters WHERE id = _character_id;
  IF NOT FOUND OR _char.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Character not found';
  END IF;

  -- Clearing family name
  IF _display IS NULL OR length(btrim(_display)) = 0 THEN
    UPDATE public.characters
      SET family_name = NULL, family_id = NULL
      WHERE id = _character_id;
    RETURN jsonb_build_object('ok', true, 'cleared', true);
  END IF;

  IF _display !~ '^[A-Za-z]{2,20}$' THEN
    RAISE EXCEPTION 'Family name must be 2-20 letters';
  END IF;
  _key := lower(_display);
  IF public._family_name_is_reserved(_key) THEN
    RAISE EXCEPTION 'That family name is reserved';
  END IF;

  -- advisory lock keyed on the family name to make the founder claim atomic
  _hash := abs(hashtextextended(_key, 0));
  PERFORM pg_advisory_xact_lock(_hash);

  SELECT id, display_name, founder_user_id
    INTO _family_id, _family_display, _founder
    FROM public.families WHERE key = _key;

  IF NOT FOUND THEN
    INSERT INTO public.families (key, display_name, founder_user_id)
      VALUES (_key, _display, auth.uid())
      RETURNING id, display_name, founder_user_id INTO _family_id, _family_display, _founder;
  ELSE
    IF _founder <> auth.uid() THEN
      SELECT EXISTS(
        SELECT 1 FROM public.family_members
        WHERE family_id = _family_id AND user_id = auth.uid()
      ) INTO _is_member;
      IF NOT _is_member THEN
        RAISE EXCEPTION 'You are not a member of the % family', _family_display;
      END IF;
    END IF;
  END IF;

  UPDATE public.characters
    SET family_name = _family_display,
        family_id = _family_id
    WHERE id = _character_id;

  RETURN jsonb_build_object(
    'ok', true,
    'family_id', _family_id,
    'display_name', _family_display,
    'founded', (_founder = auth.uid())
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_family_to_character(UUID, TEXT) TO authenticated;

-- =====================================================
-- Change family via Heraldry NPC (one change after creation)
-- =====================================================
CREATE OR REPLACE FUNCTION public.change_family_at_heraldry(
  _character_id UUID,
  _display TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _changed BOOLEAN;
  _owner UUID;
  _result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT user_id, family_changed_after_creation
    INTO _owner, _changed
    FROM public.characters WHERE id = _character_id;
  IF _owner <> auth.uid() THEN RAISE EXCEPTION 'Character not found'; END IF;
  IF _changed THEN RAISE EXCEPTION 'You have already changed this character''s family name'; END IF;

  _result := public.apply_family_to_character(_character_id, _display);

  UPDATE public.characters
    SET family_changed_after_creation = true
    WHERE id = _character_id;

  RETURN _result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.change_family_at_heraldry(UUID, TEXT) TO authenticated;

-- =====================================================
-- request_family_membership(_display)
-- =====================================================
CREATE OR REPLACE FUNCTION public.request_family_membership(_display TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _key TEXT;
  _family public.families%ROWTYPE;
  _request_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _display !~ '^[A-Za-z]{2,20}$' THEN RAISE EXCEPTION 'Invalid family name'; END IF;
  _key := lower(_display);
  SELECT * INTO _family FROM public.families WHERE key = _key;
  IF NOT FOUND THEN RAISE EXCEPTION 'That family does not exist yet'; END IF;
  IF _family.founder_user_id = auth.uid() THEN RAISE EXCEPTION 'You founded this family'; END IF;
  IF EXISTS (SELECT 1 FROM public.family_members WHERE family_id = _family.id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'You are already a member';
  END IF;

  INSERT INTO public.family_requests (family_id, requester_user_id)
    VALUES (_family.id, auth.uid())
    ON CONFLICT DO NOTHING
    RETURNING id INTO _request_id;
  IF _request_id IS NULL THEN
    SELECT id INTO _request_id FROM public.family_requests
      WHERE family_id = _family.id AND requester_user_id = auth.uid() AND status = 'pending';
  END IF;

  RETURN jsonb_build_object('ok', true, 'request_id', _request_id, 'founder_user_id', _family.founder_user_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_family_membership(TEXT) TO authenticated;

-- =====================================================
-- resolve_family_request(_request_id, _approve)
-- =====================================================
CREATE OR REPLACE FUNCTION public.resolve_family_request(
  _request_id UUID,
  _approve BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.family_requests%ROWTYPE;
  _family public.families%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _req FROM public.family_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'Request already resolved'; END IF;
  SELECT * INTO _family FROM public.families WHERE id = _req.family_id;
  IF _family.founder_user_id <> auth.uid() THEN RAISE EXCEPTION 'Only the founder can resolve requests'; END IF;

  IF _approve THEN
    INSERT INTO public.family_members (family_id, user_id)
      VALUES (_family.id, _req.requester_user_id)
      ON CONFLICT DO NOTHING;
    UPDATE public.family_requests SET status='approved', resolved_at=now() WHERE id=_request_id;
  ELSE
    UPDATE public.family_requests SET status='denied', resolved_at=now() WHERE id=_request_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'requester_user_id', _req.requester_user_id, 'approved', _approve);
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_family_request(UUID, BOOLEAN) TO authenticated;

-- =====================================================
-- cancel_family_request(_request_id)
-- =====================================================
CREATE OR REPLACE FUNCTION public.cancel_family_request(_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.family_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _req FROM public.family_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _req.requester_user_id <> auth.uid() THEN RAISE EXCEPTION 'Not your request'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'Already resolved'; END IF;
  UPDATE public.family_requests SET status='cancelled', resolved_at=now() WHERE id=_request_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_family_request(UUID) TO authenticated;

-- =====================================================
-- leave_family(_family_id)
-- =====================================================
CREATE OR REPLACE FUNCTION public.leave_family(_family_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _family public.families%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _family FROM public.families WHERE id = _family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Family not found'; END IF;
  IF _family.founder_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Founders cannot leave their own family';
  END IF;
  DELETE FROM public.family_members WHERE family_id = _family_id AND user_id = auth.uid();
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.leave_family(UUID) TO authenticated;

-- =====================================================
-- revoke_family_membership(_family_id, _user_id)
-- =====================================================
CREATE OR REPLACE FUNCTION public.revoke_family_membership(_family_id UUID, _user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _family public.families%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _family FROM public.families WHERE id = _family_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Family not found'; END IF;
  IF _family.founder_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the founder can revoke memberships';
  END IF;
  DELETE FROM public.family_members WHERE family_id = _family_id AND user_id = _user_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.revoke_family_membership(UUID, UUID) TO authenticated;
