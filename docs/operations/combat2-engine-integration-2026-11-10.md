# WoV delivery handoff — engine entry and recovery

## Reviewed source and scope

- ENG-MODERNIZE-004; Engine principles and authority, Character ownership and lifecycle, Failure/diagnostics. Integration corrections only; formulas, heartbeat, ordinary ownership and persistent player data preserved.
- Starting source `3759b90d28d4acc11a45c6b69fc5022f502adfd4`; baseline `e1faa06b4fbf59d723636bde74af6abd503609a2` ancestry verified. Cached origin inspected; fresh fetch prohibited by environment Git rules. Remote freshness not claimed.
- Reviewed recovery artifact installed before gameplay; exact checked source through `29252601bc49f05ea3736c5b7d31d7befadedfd1`. Final managed commit/push remains independently tracked; no publication performed.
- Files: GameRoute and tests, engine creature roster dead-player gate/NodeView/tests, recovery SQL candidate/native fixture, managed0033/types and engine/operational documentation. No old migrations edited, no unrelated repairs.

## Artifacts and local checks

| Artifact | Order | SHA-256 |
|---|---|---|
| `docs/operations/combat2-arena-admin-recovery.sql` | SQL first | `449cd0c8b4236e1d9506916b88f9aa1cf3abde791c195ec4c2c2503d05a9e8a5` |
| `drizzle/migrations/0033_combat2_arena_admin_recovery.sql` | Installed tool-owned copy | same hash |
| `src/pages/GameRoute.tsx` | Frontend | `69d62886caee2db24d4c321de95b8c3ac6173945b258492ece5323711f5209b4` |

- 140 tests/11 files pass: route redirect/Strict Mode/refusal/retry/generation race, engine UI/session/actions/browser isolation,46 golden fights,28 mirror tests,no-emoji. Eight real isolated PostgreSQL17.11 trigger cases pass, using exact candidate body and labeled simplified Auth/access fixtures; not full hosted concurrency proof.
- Automatic build OK. No manual build/typecheck.
- Route blank reproduced authenticated/unselected; declarative redirect now reads back creation screen for Mik's zero-character account. Returned RPC errors cannot claim preparation success; generation fencing preserves Strict Mode without duplicate attempt.
- Recovery preserves postgres SECURITY DEFINER/search_path and complete installed ACL; only authorized admin relocation marker plus enrolled tester/exact active destination/unchanged identity permits other-owner relocation. Player/departure gates and private EXECUTE remain intact. No privilege expansion.

## Hosted verification and ordered delivery

1. Fresh read-only guard/caller definitions matched pinned MD5s; quiet world asleep/no active encounter/live claim. Installed via standard managed Drizzle once; ledger33→34/new id34 exact artifact hash, prior id33/id32 hashes preserved. Types regenerated automatically. Installed guard MD5 `2093bfd22068436f5a0e3cfb8b3645d7`; postgres owner, DEFINER, public/auth/pg_temp path and postgres/service/platform ACL unchanged.
2. Mik's authenticated admin UI reset accepted; tester0→16HP and arena staging. Admin relocation through installed API accepted to low arena. No raw revive/ownership bypass.
3. Retired `combat2_test_environment_start/close` authenticated calls refused42501; no grants added or refusal weakened. Current supported tester wake/selection/presence path automatically enabled engine processing; current admin Emergency Shutdown restored safety.
4. Tester u1/F10-Leader selected via real UI after Awaken the Realm. Engine roster rendered; aggressive creature engaged automatically, visible HP/damage/grazing logs updated. Terminal encounter `23436e1c-670e-408b-bee8-ef997daa10fe`, status ended, tick6; player0/16HP, creature80→72HP. No fake outcomes. Desktop/mobile screenshots inspected; no page errors/overflow. This is a classless basic-attack fight, not class spellbook/ability acceptance or multiplayer proof. Refreshed terminal log did not retain earlier live narration; archive follow-up remains distinct.
5. Found dead-player Attack controls visible/enabled; source gate corrected and tested. Final admin reset accepted; fresh23:26:44UTC read confirms tester16/16HP at staging,0 active encounters/claims/recordings.23:26:02UTC world asleep, maintenance;23:26:03UTC0 scheduler jobs. Completed prior reports preserved by arena reset API.
6. No Edge source changed or deployment needed. Mik manually publishes frontend; no automatic publication.

## Authorization, STOP and recovery

- Mik's broad engine-integration instruction used for narrow source/recovery installation and bounded tester fight; no player data deletion, mass legacy cleanup or privilege relaxation.
- Live worker rules already use engine; remaining fenced client Combat1 controller mounts and generic command migration are not retired by this task. Shared inventory/movement/consumable dependencies need explicit engine replacements, not stubs or directory deletion.
- Next safe work: class-ability/live spellbook acceptance and a dedicated engine-only player controller retaining server movement/equipment/consumables contracts. General production audit/manual/backlog integration remain separate.