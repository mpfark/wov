-- Defense-in-depth RLS for server-internal Combat2 scheduling and arrival state.
-- Existing SECURITY DEFINER owner functions continue to bypass non-forced RLS.
ALTER TABLE public.combat2_dispatch_schedule_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_arrival_group ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.combat2_dispatch_schedule_state FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.node_arrival_group FROM PUBLIC,anon,authenticated;

GRANT SELECT,UPDATE ON TABLE public.combat2_dispatch_schedule_state TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.node_arrival_group TO service_role;