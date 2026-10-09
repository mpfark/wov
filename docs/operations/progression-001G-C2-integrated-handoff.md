# C2 integrated cutover — local preparation

Starting source `662a0c44dfb30623f41b776e3b36111cbd334f5f`; synchronized/final local and remote HEAD `4526c11e2ee6e6c0a79b5b8f7232bb86c391c220`. Recorded baseline `b9d82b8f` is an ancestor. Work remains uncommitted; no push. Recovery stash remains `0a5529d5227675319b166881b10f1c91edd7486b`.

Mik confirms **0007–0011 installed, private, inactive**. This is supplied evidence, not Codex hosted verification. The generated0011 Git SQL blob exactly matches reviewed `80e1259050b4f1ddb6309a236a910c96a9a3d3102e0b1e6f3a7d7565c0329b93`; journal ends at idx11; snapshot/types arrived in platform commit4526c11e. No migration, journal, snapshot, generated types or Supabase history was edited here.

## Implemented integration and reconciliation

- `creation-client.ts` submits only name/race/gender, UUID and pinned creation revision to the **public bridge**, never the private primitive. Delegation adds target/reason. Session-scoped, actor/target-bound pending intentions survive transport errors/reloads; changed payload refuses. Explicit transactional errors release the intent; unknown responses/read failures retain it. Purged replay is terminal. All four version identities/applied values remain owned by installed0009 and its unchanged manifest.
- The existing creation page now uses approved manifest race choices, preserves capitalization, accepts the server's40-character limit, displays retained quota, and removes client stat/resource/class/location/family writes. The character hook reads the authoritative owned row before acknowledging/selecting, deduplicates deliveries and respects newer tombstones. No client materials, inventory or progression initialization.
- UserManager adds **Overlord-only** delegation/restoration/purge controls using the bridge/lifecycle command and existing admin-users read endpoint. Reasons, permanent confirmation, deadline/version and replay are explicit. Tombstones are labelled; ordinary action/edit controls are blocked. Server ownership/live-role/deadline checks remain decisive. Existing own deletion/selection/gameplay exclusions are retained; restoration never regrants resources.
- Only the two P2-B owner-membership assertions changed: exclude the actual postgres owner, retain effective application/custom-member/PUBLIC checks. P2-C cutover and runtime-exclusion bytes remain unchanged.
- The directly encountered approved C2-04 family gap receives one source-guarded shared-function patch: lock/revalidate owned active character, require L10 only in the founding branch; preserve L1 joining and existing ACLs. No family at creation, new family system or existing-character rewrite.

## A — pre-cutover installation (separate authorization)

Use **only the standard Lovable Drizzle tool**, after source publication is separately authorized. Verify installed prefix0000–0011 (12 entries) and artifact hashes. Tool owns next migration SQL/journal/snapshot/types; do not pre-create a numbered file or touch Supabase history.

Install `integrated-private-support.sql` in one transaction: four postgres-owned, fixed-search-path, private functions: `character_creation_capacity(uuid)`, `character_creation_expire_receipts_internal()`, `character_receipt_maintenance_internal()`, `character_account_deleted_internal()` (trigger). No tables, new gameplay authority, public grants, attached account trigger, job or existing-record updates. Check default/inherited EXECUTE restrictions and unchanged data/legacy permissions after A. **Do not publish the frontend with A alone.**

Capacity counts every retained character; installed0009 still enforces quota under account serialization. Maintenance clears expired creation details, keeps live-actor minimal replay, expires existing lifecycle detail and removes expired purge replay only after its actor account is absent. A daily administrative cleanup is independent of the unchanged authoritative world heartbeat; it never deletes characters.

Controlled permanent account deletion retains the existing privileged Auth boundary, adding no account-delete API or permission. B's character fence rejects account cascades while any retained character remains; explicit approved purge must precede account removal. Auth AFTER DELETE retires **that actor's** creation identifiers/digest, preserving unexpired12-month history and other recipients' origins. Expired lifecycle replay is removed; unexpired history finishes its original clock. Commands hold auth identity KEY SHARE before ledger writes; the hook relies on the DELETE's identity lock and takes no inverted account advisory lock. Ledger order is creation then lifecycle. Administrative removal of accounts with retained characters is deliberately refused, including before30 days.

## B — coordinated cutover (separate authorization)

Run the existing P2-C preflight plus narrow `integrated-preflight.sql`; no broad re-audit. Require zero material orphans, matching original runtime/family body hashes/owners/search paths, bounded installed FK/trigger map, existing pg_cron schedule API and installer TRIGGER privilege on auth.users. Inspect existing Auth triggers for conflicting cleanup. Stop on drift, unexpected privileges/objects or maintenance-job collision. **Positive orphan count requires Mik's explicit data-disposition decision; no automatic repair/deletion or skipped FK validation is prepared.**

In a coordinated maintenance window install **the single generated `integrated-cutover.sql` in ONE transaction**:

1. Validate materials FK; close legacy creation/harness/hard-delete EXECUTE and direct character INSERT/DELETE, preserving unrelated UPDATE columns.
2. Apply the unchanged three runtime exclusions and the narrow family guard.
3. Apply unchanged P2-C character/child fences, restrictive active-character selection and lifecycle command authorization.
4. Attach the controlled Auth-deletion hook; schedule one private daily receipt cleanup; grant authenticated EXECUTE on creation bridge/capacity. Anon/service/internal execution stays denied; private storage stays inaccessible.
5. Commit only if every assertion succeeds. There is no externally visible transaction interval with both old and new creation authorities. **Do not install component files separately.** `prepare-c2-integrated-cutover.mjs --check` verifies exact composition.
6. Verify resulting objects/ACLs and generated tool artifacts/automatic commits after success **or failure**. No new Edge code/deployment is required: existing admin-users performs service-authorized tombstone reads; verify its installed list behavior. Frontend source and database cutover are separate: old frontend may fail closed during the maintenance window. After verification, **Mik manually publishes** the reviewed frontend; no automatic publication.

## C — verification and recovery

Metadata: verify legacy/root/custom inherited access closed; only authenticated bridges executable; private primitives/storage denied; protected15/unprotected38/six preferences preserved, new lifecycle columns not directly editable; FK validated; fences/active predicates present; Auth hook owner/private ACL; exactly one postgres receipt job, existing world jobs unchanged. Review tool SQL/hash, ledger prefix, journal/snapshot/types and unexpected automatic source changes separately.

Only after separate runtime authorization, use one designated canary account: own create + exact replay (one character/seven material rows/statev0/origin/log, no inventory), conflicting payload refusal, own soft-delete removes selection but counts quota/reserves name, Overlord reasoned restore retains values, unauthorized/delegated role denial. Do not age production rows to test purge/expiry; observe deadline refusal, and test eligible purge only on an explicitly approved naturally expired canary. Verify empty-equipment/unarmed combat separately before claiming hosted integration. Local tests do not replace JWT/Realtime/platform behavior or true multi-session evidence.

Any installation failure must roll back the entire package; verify original objects/history before retry, do not resume midway. After successful B, unpublishing the frontend **does not** restore database permissions/fences. On a runtime defect stop creation/lifecycle entry, retain fences/data/audit, pause only the dedicated receipt job if implicated, and prepare a separately authorized forward fix. Never blindly restore legacy grants, delete receipts, remove the name index or run old hard-delete helpers.

## Validation and retained gates

80/80 disposable PostgreSQL/PGlite SQL tests (P2-A21, P2-B16, extended P2-C43);29/29 frontend/tracking tests (creation client5, hook14, creation page3, admin lifecycle4, project-state3). App TypeScript and project-state/generated-view/composition/diff checks pass. No full suite/build or baseline failure claimed. pg_cron scheduling is an explicitly mocked catalog/API fixture, not proof of a real job. PostgreSQL/psql/docker were unavailable on PATH; one embedded backend cannot establish independent-session contention/deadlock behavior.

**GO for local preparation / conditional A installation proposal; NO-GO for activation now.** Fresh narrow prerequisites, orphan disposition if needed, separate source/install/cutover approvals and hosted verification remain. Four F limitations unchanged: **HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.** No runtime-mode/Edge/world cadence changes.

Affected specification: canonical progression/creation, resources/attributes, authority and failure verification; roadmap ENG-PROGRESSION-001G/C2. Approved rules preserved. No hosted access, installation, gameplay writes, deployment, activation, frontend publication, commit or push occurred.

## Reviewed SQL (UTF-8/LF SHA-256)

| File under docs/operations | SHA-256 |
|---|---|
| progression-001G-C2-integrated-private-support.sql (A) | 5aa1c167bd59c239e94bdfd9e7a929f5ed060deda9ad3f754a68b83b8e01938c |
| progression-001G-C2-integrated-cutover.sql (B) | 2977ee653b31c8ecca9ff2881e5764bc97251f1212d0b0457c8f5bbee5ea6024 |
| progression-001G-C2-integrated-enable.sql (component only) | ebacf7073010fc86d0a978684c982ff1280210e64881f4501fd03a4c2e5590d5 |
| progression-001G-C2-integrated-family-guard.sql (component only) | 71920f43e0f4023ddc2777b8a60a2e57083ee64e6cc726f79f20217200f3c7c4 |
| progression-001G-C2-integrated-preflight.sql (read-only) | 117dfa0ae3c180eed64ebbbb9d7a3cb169ab1bc5044da1df53cf0931a523417d |
| progression-001G-C2-P2-B-cutover-containment.sql (corrected component) | 925f8b62c7bf6b2a4980a150749df3e62f756c2be541e6c33e7411ce30c2c520 |
| progression-001G-C2-P2-C-lifecycle-cutover.sql (unchanged) | 222e52df6a656ce7c015829037255f38391ee0112ae5d574121710e7670483f7 |
| progression-001G-C2-P2-C-runtime-exclusions.sql (unchanged) | ba2df76c3c65f4310d0f609d69605d7e1c6db788efc0419cc23c387ebe420f22 |

## File inventory

Modified: P2-B containment SQL; existing P2-C SQL test; `src/pages/CharacterCreation.tsx`, `Index.tsx`; `src/features/character/hooks/useCharacter.ts`, hook test; `src/contexts/GameContext.tsx`; admin `UserManager.tsx`, `CharacterListColumn.tsx`, `AdminCharacterSheet.tsx`, `constants.ts`; roadmap and project-state JSON/generated Markdown.

New: five integrated SQL artifacts above; this handoff; composition script; creation client/helper test; creation-page test; admin lifecycle controls/test. All are local preparation, not a release checkpoint.
