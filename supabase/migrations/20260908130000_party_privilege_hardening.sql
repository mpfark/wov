-- Close platform-default table privileges around the authoritative party boundary.
-- SECURITY DEFINER functions retain owner access; browsers use only the public RPCs below.

-- Remove dormant browser-write policies so a future grant cannot reactivate the retired path.
DROP POLICY IF EXISTS "Character owner can create party" ON public.parties;
DROP POLICY IF EXISTS "Leader can update party" ON public.parties;
DROP POLICY IF EXISTS "Leader can delete party" ON public.parties;
DROP POLICY IF EXISTS "Can insert party members" ON public.party_members;
DROP POLICY IF EXISTS "Can update party members" ON public.party_members;
DROP POLICY IF EXISTS "Can delete party members" ON public.party_members;

-- Start from no direct privileges. ALL includes SELECT, DML, TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN on PostgreSQL versions that expose MAINTAIN.
REVOKE ALL PRIVILEGES ON TABLE
  public.parties,
  public.party_members,
  public.party_operation_request
FROM PUBLIC, anon, authenticated, service_role;

-- Participant-scoped RLS still governs these two SELECT grants and Realtime invalidation.
GRANT SELECT ON TABLE public.parties, public.party_members TO authenticated;

-- Established server administration may inspect and perform ordinary row-level maintenance.
-- It does not receive TRUNCATE, REFERENCES, TRIGGER or MAINTAIN from this contract.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.parties,
  public.party_members,
  public.party_operation_request
TO service_role;

-- These UUID-keyed tables have no owned sequences. Revoke any future matching owned
-- sequence defensively without affecting sequences belonging to unrelated tables.
DO $party_sequence_privileges$
DECLARE sequence_record record;
BEGIN
  FOR sequence_record IN
    SELECT DISTINCT sequence_namespace.nspname AS schema_name, sequence_class.relname AS sequence_name
    FROM pg_class table_class
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
    JOIN pg_depend dependency ON dependency.refobjid = table_class.oid
      AND dependency.deptype IN ('a', 'i')
    JOIN pg_class sequence_class ON sequence_class.oid = dependency.objid
      AND sequence_class.relkind = 'S'
    JOIN pg_namespace sequence_namespace ON sequence_namespace.oid = sequence_class.relnamespace
    WHERE table_namespace.nspname = 'public'
      AND table_class.relname IN ('parties', 'party_members', 'party_operation_request')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM PUBLIC, anon, authenticated',
      sequence_record.schema_name, sequence_record.sequence_name);
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %I.%I TO service_role',
      sequence_record.schema_name, sequence_record.sequence_name);
  END LOOP;
END
$party_sequence_privileges$;

-- Reset function ACLs before granting the exact browser/server contract.
REVOKE ALL ON FUNCTION public.party_mutate(uuid,text,uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.party_state(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.combat2_party_preflight(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.party_can_view(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.party_operation_finish(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.party_combat_mutation_blocked(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_party_member(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_party_invite(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_party_tank(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.combat2_validate_party_tank() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.combat2_party_tank_changed() FROM PUBLIC, anon, authenticated, service_role;

-- Intended authenticated entry points. party_can_view is the narrowly scoped safe
-- read predicate required by the participant SELECT policies.
GRANT EXECUTE ON FUNCTION public.party_mutate(uuid,text,uuid,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.party_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_party_preflight(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.party_can_view(uuid) TO authenticated;

-- Established server operations retain their RPC and internal-helper execution paths.
GRANT EXECUTE ON FUNCTION public.party_mutate(uuid,text,uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.party_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.combat2_party_preflight(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.party_can_view(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.party_operation_finish(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.party_combat_mutation_blocked(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_party_member(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_party_invite(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_party_tank(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.combat2_validate_party_tank() TO service_role;
GRANT EXECUTE ON FUNCTION public.combat2_party_tank_changed() TO service_role;
