# ENG-LEGACY-001C2 — resource synchronization and AC ownership

Local investigation, 2026-10-12, checkpoint `2ba016cc9a05df8d9b2980d106150789c6ee357d`. Reuses [C1](legacy-001C1-resource-equipment-writer-map.md) and [B closeout](legacy-001B6-combat2-closeout.md). No correction, SQL execution, hosted operation or gameplay probe. Findings concern source contracts; current installed sync/trigger behavior remains unverified.

## Exact read/calculate/write chain

`src/pages/GameRoute.tsx:48–68` → authenticated `sync_character_resources(uuid)` → `supabase/migrations/20260922112544_a2d63b3d-4f07-4641-a911-f6cf25ee1b45.sql:4–54` → characters UPDATE → existing character triggers → RPC result → character refetch. Route entry checks identity/generation, but the RPC runs independently of the legacy stance-clear flag. Client generation checks protect presentation, not database serialization.

Inside the definer RPC:

1. `owns_character` check; SELECT characters record without FOR UPDATE (`19–21`).
2. Aggregate equipped, positive-durability inventory joined to items (`23–35`). No character/inventory lock or loadout fence. The aggregate is a separate SQL statement, so ordinary READ COMMITTED execution can observe a different statement snapshot from the earlier character read.
3. Calculate hardcoded class HP base, stat modifiers and saturated maxima (`37–44`); clamp **captured** current HP/CP/MP (`45–47`).
4. Set trusted-RPC transaction setting, UPDATE maxima/current resources from those variables (`48–50`), return them. UPDATE locks the row but does not refresh the previously computed PL/pgSQL values. No AC write, no base-attribute write, no regeneration award or retry ledger.

Source grants: PUBLIC/anon revoked, authenticated/service EXECUTE retained (`56–57`); service permission alone does not satisfy owns_character. Each PostgREST RPC is its own transaction. Default hosted transaction isolation, function owner/settings/effective ACL and installed trigger side effects require metadata readback; no current metadata is invented.

## Minimal locking invariant and interleavings

**Proposed invariant:** obtain the target character row FOR UPDATE **before reading its current HP/CP/MP, base attributes, class or level**, then calculate and clamp from that locked record, with all writes in the same RPC transaction. Retain authorization, missing/deleted-target handling, bounds and the no-free-heal policy. Do not fill resources merely because a maximum increases. This is a proposal, not implemented SQL.

Example: sync reads HP80; combat commits HP50; sync writes its captured HP80. The same pattern can discard healing or CP/MP changes. With the character lock on the initial read, sync waits for earlier character mutations and reads their committed values, while later mutations wait until sync finishes. An early lock solves this sync stale-record overwrite without a new generalized framework.

| Concurrent owner (reused evidence) | Existing order/boundary | Implication for sync |
|---|---|---|
| Combat commit | B3A node → encounter → character/inventory/domain writes; core 0002:367–378 uses UPDATE against stored caps; durability 525–539 follows validated loadout fence. | Serialize on character; sync must not acquire encounter/node locks afterward. This does not prove all preclaimed absolute proposals remain fresh against every resource mutation. Do not reopen B or claim universal concurrency safety. |
| OOC settlement | 0013:359–507 cursor → UUID-ordered character locks, rechecked eligibility and equipment-derived caps; excludes live combat/claims as described in B7. | Lock current character before calculation, preserving each writer's existing domain eligibility. No need to adopt settlement cursor/regen logic in a sync RPC. |
| Canonical progression | 0001:81–117 `character_sync_derived_internal(uuid,boolean,boolean)` locks character then reads class/equipment; enclosing XP/stat/class/respec authority supplies decision/replay/version. | Serialize against attributes/level/resource changes; keep progression level-gain HP policy separate from equipment sync. |
| Inventory action/repair | September inventory authority locks character before selected inventory updates, per C1. | Character-first sync can serialize with these canonical gear writers. However equip/repair and later sync remain separate transactions; the early lock does not make them one operation. |
| Direct service inventory delegates | C1 restricted degrade/forge-strip boundaries do not establish a character-first lock across their whole operation. | Do not claim character lock alone freezes all inventory/template writers. Additional inventory locks or writer changes require exact dependency evidence; matching existing character-first ownership is preferable to introducing inverse inventory → character locking. |

No new node/encounter lock is needed for the proposed minimum. Adding one after the character lock would risk reversing established combat order. Gear consistency is a second invariant: all mutations of the equipment used for cap calculation must participate in compatible serialization or cause a detectable loadout change. Row-locking existing inventory entries alone does not cover phantom inserts or template edits. Avoid silently expanding the minimal stale-resource correction into every inventory writer.

## Equipment callbacks and cap freshness

| Path and source | Actual synchronization chain | Gap / reachability |
|---|---|---|
| Equip/unequip, `useInventory.ts:112–130` | Successful character_inventory_action RPC → separate syncResources RPC → onResourcesSynced → fetchInventory. GamePage:387 wires callback to refetchCharacters. | Distinct transactions; syncResources (`82–89`) ignores `{error}` result and still calls refresh unless a promise throws. GamePage:388–389 wraps equip/unequip in useControlledAction(legacyExecution.allowed); `139–140` derives fence from Combat2 ownership/flag. These are source paths, not proof controls are currently usable in Combat2. Direct RPC authority and UI fencing are distinct. |
| Inventory-change notification, `useInventory.ts:73–79` | inventory:changed → fetchInventory only. | Inventory refresh is not resource synchronization; recalculated UI bonuses do not persist maxima/AC. |
| Repair, BlacksmithPanel:78–88 and JewelcrafterPanel:78–89 | character_repair RPC → gold callback + onInventoryChange; GamePage:1875–1916 supplies fetchInventory and optional refetchCharacters. | Both panels destructure onCharacterRefresh as unused `_onCharacterRefresh` (Blacksmith:58, Jeweler:55). No explicit sync in repair body (September inventory migration:147–220). A repair crossing zero durability changes effective gear contributions; installed trigger coverage is unresolved. |
| Combat wear/break | 0002:525–539 validated decrement, zero-durability unequip or unique deletion in combat commit. | No explicit sync call at the wear branch. Claimed loadout applies for that tick; next equipped snapshot recalculates, naked snapshot uses persisted caps/AC. Automatic installed synchronization is not established by an inventory refresh. |
| Gem strip | forge-strip Edge:81–92 separately consumes material/debits gold/clears gems; useForgeUpgradeView:172–182 refreshes inventory/gold/materials. | No explicit sync in these inspected bodies, no atomic character lock across Edge calls. Do not investigate crafting economy or change item policy here. |

**Assessment:** persistent maxima are an established SQL projection used for current-resource clamps, respawn and naked combat snapshots, not merely disposable UI values. Equipment consumers also calculate effective caps dynamically. Source callback chains leave a freshness gap after some gear mutations; absence of source evidence is not proof no installed trigger exists.

## AC ownership and freshness

- C2 creation writes `characters.ac` from pinned starting classless/class/DEX rules (`drizzle/migrations/0009_progression_001g_c2_p2_a_creation_authority.sql:106–119,138`). This is the established initial stored AC writer.
- Historical one-time DO migrations also wrote AC: February `20260220164857_829bfa36-8cd3-41b5-a999-637a6bbd0c3e.sql:118`, February `20260221225522_62e0c8b6-04eb-4dff-aed1-06a4128fbb0d.sql:36–38`, March `20260305230152_cb556f4f-f2e2-4472-8dd8-875bb259349b.sql:95` (all under supabase/migrations). These are frozen history, not current callable synchronizers. `restrict_party_leader_updates()` in June `20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql:7–108` restores OLD.ac for untrusted own-character writes and clamps trusted values to 1–100; it does not derive AC from DEX/class/gear. Its exact installed binding/body is required evidence, not an inferred current universal gate.
- Inspected current sync (`September max-CP source:49–50`) and canonical derived helper (`0001:116`) update maxima/current resources, **not AC**. Inspected canonical DEX/class mutations in 0001/0003/0005 delegate that helper. No ongoing stored-AC refresh is established by these writers; an installed trigger or other documented writer must be checked before concluding it is absent everywhere.
- Claim emits `ch.ac` (`supabase/migrations/20260829135558_f0037825-ccff-4b35-b0b2-aa6566be826c.sql:85–100`); decoder reads fighter AC; mirrored resolver `src/shared/combat2/resolver.ts:92–110` retains it for zero equipment, otherwise calculates from class/base DEX + usable equipment DEX/AC and usable shield. The comment claiming persisted AC is already maintained by sync conflicts with the inspected sync body.
- UI `GamePage.tsx:878–879` dynamically calls getEffectiveAC with shield=false; worker sets hasShield from usable off-hand shield. This is a concrete consumer difference, not proof of a live shield-display error or wrong damage result. Legacy/presentation usage and actual loadout determine its impact.
- Formula owner is `src/shared/formulas/combat.ts:229–249`: class base + floor((DEX−10)/2), gear DEX/AC and shield contribution. Base persistent DEX must not be rewritten to include gear.

**Recommendation:** retain the existing stored-versus-effective distinction until metadata establishes the missing writer/trigger. Do not simply add an AC field to the stale-resource patch. If no writer exists, the smallest explicit contract decision is whether to maintain stored naked/base AC on relevant base/class changes (consistent with naked resolver fallback), or always derive it in consumers. Those choices affect more than a row lock and require review. Do not store gear-derived bonuses into base attributes or assume the UI formula is the persistence authority.

## Empty override semantics

SQL sync: `COALESCE(NULLIF(ci.stat_override,'{}'::jsonb),i.stats,'{}'::jsonb)` (September source:24); canonical derived helper 0001:99–110 and OOC 0013:450–467 reuse the empty-as-absent convention. TS effectiveItemStats (`src/shared/formulas/items.ts:151–164` and its Edge mirror) uses `statOverride ?? baseStats ?? {}`: `{}` is an explicit empty base, with applied gems layered afterward. `useInventory.ts:42–47` passes raw override; claim emits raw ci.stat_override, decoder accepts numeric empty object (`_shared/combat2/decode.ts:148`), resolver passes it unchanged.

For a template CON2 and override `{}` with no gems, SQL counts CON2 while TS counts zero. With null override both use template. A nonempty override replaces the template in both; gems layer on the selected base. Thus affected consumers include sync/progression/OOC caps versus inventory display, combat effective attributes/caps/AC and other shared item-stat consumers. Empty override occurrence and intended meaning are **not established**; do not normalize existing data or silently choose a policy. Static behavior is established independently of any hosted row.

## Exact metadata needed before correction

Separately authorize only:

1. Full installed definition/normalized fingerprint, owner/definer/search_path, signature/defaults, direct/effective anon/authenticated/service EXECUTE for `sync_character_resources(uuid)` and `character_sync_derived_internal(uuid,boolean,boolean)`.
2. All noninternal trigger **metadata** on public.characters and public.character_inventory; full bound definitions only for resource/AC/stat/durability/lifecycle writers/guards relevant to this change, enabled state and owner/security. Include constraint triggers, not just familiar names. Confirm characters current/max-resource/AC types/checks and inventory override type/default/checks.
3. Exact definitions of `character_inventory_action(uuid,text,uuid,text,uuid)` and `character_repair(uuid,text,uuid,uuid)` if they differ from source or trigger results introduce synchronization; relevant mutation EXECUTE/table privilege boundaries, not a database-wide grant scan. Obtain server/transaction isolation metadata for the inspected RPC environment without invoking gameplay commands.

No character/inventory row read is needed to prove the source discrepancy. If metadata cannot establish the intended `{}` contract, ask the owner for item-policy clarification separately; do not request a broad data scan. B's 29 unchanged triggers and historical function inventories do not substitute for exact current readback of this sync boundary.

## Smallest next task and validation

Recommend a minimal metadata-only sync/AC preflight next, followed by separately authorized correction of the **early character-row lock only** if installed body matches. Keep AC freshness, empty-override policy and callback transactionality as explicit separate follow-ups; do not bundle a formula rewrite or all inventory authorities. No installed/runtime defect or universal deadlock freedom is claimed. C remains open; progression/B closures, four F limitations, v3→v2 uncertainty and recovery stash preserved. Administrative XP grants remain paused; normal gameplay XP policy unchanged and runtime not newly established.

Validation: existing read-only source/formula/project-state checks, documentation links, synchronization and whitespace. No SQL execution or test modifications; environment failures must remain separately reported. No commit/push.

Results: 77 tests PASS across inventory/OOC source guards, effective/formula parity, mirror equality and project-state; one existing shell-based import-specifier test FAILS with `spawnSync bash ENOENT` (`shared-mirror-identity.test.ts:45`). No demonstrated mirror mismatch; no bypass or test modification. State synchronization, report links, preservation and whitespace checks PASS. These tests do not prove installed locks/trigger behavior or cross-session correctness.
