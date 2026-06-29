-- Manually fulfill the orphaned contract for Camdria (combat-tick wasn't re-deployed when contract code shipped).
SELECT public.apply_contract_complete('9ed82af2-cddd-4e6d-bfa4-2305610c7b11'::uuid, 1);
SELECT public.award_party_member('9ed82af2-cddd-4e6d-bfa4-2305610c7b11'::uuid, 10, 2, 0, 0);