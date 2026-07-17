
-- ============================================================
-- M4: Participant lifecycle
-- Makes encounter_participants the source of truth for
-- "who is currently engaged in a node's encounter".
--
-- Disengage triggers automatically when a character:
--   - moves to a different node (move / teleport / summon / wimp flee)
--   - dies (hp <= 0)
--   - has their current_node_id nulled (logout / session end)
--
-- No creature state is reset here — creature HP persists across
-- disengage. That's the whole point: leaving the node no longer
-- rolls creatures back.
-- ============================================================

-- Explicit disengage RPC (also callable from edge functions if we ever want).
CREATE OR REPLACE FUNCTION public.encounter_disengage(_character_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed int;
BEGIN
  WITH del AS (
    DELETE FROM public.encounter_participants
    WHERE character_id = _character_id
    RETURNING encounter_id
  )
  SELECT count(*)::int INTO v_removed FROM del;
  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_disengage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_disengage(uuid) TO authenticated, service_role;

-- Explicit engage RPC — thin wrapper over the existing ensurer.
CREATE OR REPLACE FUNCTION public.encounter_engage(_character_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.encounter_ensure_for_character(_character_id);
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_engage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_engage(uuid) TO service_role;

-- Trigger function: auto-disengage on node change / death / logout.
CREATE OR REPLACE FUNCTION public.trg_character_encounter_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Node change (including nulled node_id on logout)
  IF NEW.current_node_id IS DISTINCT FROM OLD.current_node_id THEN
    DELETE FROM public.encounter_participants
    WHERE character_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Death: transitioned from alive to dead
  IF OLD.hp > 0 AND NEW.hp <= 0 THEN
    DELETE FROM public.encounter_participants
    WHERE character_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_characters_encounter_lifecycle ON public.characters;
CREATE TRIGGER trg_characters_encounter_lifecycle
AFTER UPDATE OF current_node_id, hp ON public.characters
FOR EACH ROW
EXECUTE FUNCTION public.trg_character_encounter_lifecycle();

-- Optional maintenance: mark encounters idle once all participants have left.
-- Kept passive here — M5 (reconciliation) is the right home for status flips
-- and creature cleanup. This trigger only removes participant rows.
