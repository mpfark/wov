# ENG-PROGRESSION-001G-C2-P0 — Minimal remaining Lovable evidence request

**PREPARED ONLY / NOT SENT / NOT EXECUTED.** Owner must separately authorize Lovable.
Use [P0 findings](progression-001G-C2-P0-evidence.md) and the
[operating contract](lovable-supabase-operating-contract.md). The prompt below is
limited to remaining metadata; later-phase requests can be deferred separately.

## Copy-paste request

Perform a separately authorized **read-only metadata inspection**, no implementation.
Planning source `9489b991b3e4c4be5c443d2fa246d0382ca62c7e`; reconcile actual source
ancestry before reporting. Do not infer installed bodies from local migrations.

Reuse the original C1 safe output wherever available. Do not repeat the six-race,
classless HP18/AC10, resource/gold defaults, sole reported 40-salvage/six-gem grant,
creation overload count/client-authority summary, or entire progression/F preflight.
If current metadata contradicts reused evidence, identify drift and narrow follow-up.
No staff, inventory contents, sockets, crafting, keys or secret records.

### Required now: P1 identity/storage metadata

Return only catalog metadata using SELECT against pg_catalog/information_schema:

1. **Identity and constraints.** characters id/user_id/name column types,
   nullability, name collation, all name indexes/uniqueness/check expressions;
   any account quota/soft-delete columns, constraints or enforcing triggers. Exact
   relevant FKs (including characters→Auth identity), delete actions/deferrability,
   reverse FKs from progression state/receipt, inventory/materials and any existing
   creation request/origin proof storage. For canonical account identity return
   key/constraint metadata only, never account rows. No additional default survey.
2. **Triggers.** List enabled INSERT/DELETE triggers on characters and INSERT
   triggers on character_inventory/progression_character_state, including internal
   constraint triggers. Return exact safe definitions only for noninternal trigger
   functions and their actual nonsecret initialization/deletion delegates. Explain
   any sidecar or mandatory-equipment dependency; internal FK definition is enough.
3. **Capability boundary.** Owners, relrowsecurity/force flags, applicable policies,
   direct table/column grants and effective INSERT/DELETE/REFERENCES/TRIGGER on the
   affected identity/storage tables for anon/authenticated/service_role and relevant
   application members; default function/table grants that new private objects
   would inherit. PUBLIC is ACL grantee zero, not a role. Obtain actual transitive
   membership edges and effective USAGE/global-data/BYPASSRLS capabilities only
   where needed for this closure. Distinguish platform administrative read authority
   from application access; no exemption based on names or superuser MEMBER results.
   Preserve F protected15 denied/unprotected38 allowed/no service table UPDATE and
   authenticated six preference columns; do not broaden/rewrite grants.
4. **Conflicts and deletion boundary.** Return existence/type only for prospective
   public.character_creation_request, character_creation_snapshot,
   character_creation_receipt, character_creation_account_lock (candidate names,
   not committed schema). If present, return relevant safe schema/constraints/ACL
   metadata; do not read rows. Return current delete_character_cascade(uuid) safe
   body, signature, owner/security/search_path/direct and effective EXECUTE for
   PUBLIC/anon/authenticated/service_role; same for actual deletion delegates.
   Identify installed Auth-account cascade semantics from FKs/deletion triggers,
   and relevant known application deletion functions from catalog definitions.
   Catalog body searches are discovery aids, not proof against dynamic/external
   writers. Do not invoke Auth APIs or functions to test deletion.

No gameplay/character/account/private sidecar/receipt/material/inventory rows.
Collision and over-quota aggregate reads are **deferred** to a separately authorized
pre-install preflight after normalization is approved; do not expose names/IDs.
No migration-tool invocation, rehearsal, transaction that executes a gameplay
function, fixture or privilege change. Read-only transactions are fine.

### Later-phase metadata: defer unless separately included in authorization

P2: recover original full safe character_create definition/signature and actual
delegates/type dependencies; relevant private resource helper identity/definition.
For no-equipment integration, current combat_enter and its actual predecessor
chain, node_tick_claim and its actual predecessor chain, and the equipment JSON
projection in the innermost claim. Return only relevant safe definition excerpts
with exact signatures, identities and surrounding context; metadata cannot prove
successful entry or deployed Edge runtime. No combat calls or live bundle retrieval.

P3: current apply_family_to_character(uuid,text), change/delegate founding chain,
has_role identity/role-source metadata and family INSERT/RLS/EXECUTE closure;
no role assignments, member records or family names. Retrieve prior safe output
before repeating definitions. No founding/joining calls.

### Return and stop

Timestamp every observation; identify original reused output versus freshly read
metadata, installed object signatures, inaccessible/withheld evidence and scope.
Where body text could expose secret literals, do not print/hash/prefix it; withhold
the body, return safe identity metadata and the unresolved dependency. Never read
Vault/key material, passwords, service keys, session tokens, environment or logs.
Do not change roles to pass checks or substitute a privileged secret read.

Report P1 blockers separately from P2/P3/activation gaps. Confirm no DML/DDL,
gameplay/Auth operation, migration, deployment, activation or publication. F remains
CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED / FRONTEND NOT PUBLISHED;
retain HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED;
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.
STOP after reporting. This request authorizes no P1 implementation or installation.
