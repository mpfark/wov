## What I found

- The live database has **936 common/uncommon equipment rows**.
- **72 rows still use legacy archetype names** that the current tools no longer understand:
  - Common belt-only legacy archetypes: `Bardic`, `Enlightened`, `Ironroot`, `Tyrant` — 9 rows each.
  - Uncommon legacy hybrid: `Arcstrider` — 27 rows.
- Several L21/L41 rows still have stale INT-heavy stats such as `{cha:1,int:4,wis:1}` or `{int:8,wis:4}` even when the name implies something else. This is why Sanctified and other archetypes can still look wrong.
- The previous rewrite failed because it only trusted canonical names; legacy names were skipped or mis-inferred.

## Proposed fix

1. **Add a legacy alias map to the rewrite function**
   - Teach `rebuild-archetype-stats` to recognize old archetypes and map them safely:
     - `Tyrant` -> `Vanguard` / STR common
     - `Ironroot` -> `Stoneguard` / CON common
     - `Enlightened` -> `Sanctified` / WIS common
     - `Bardic` -> `Crowned` / CHA common
     - `Arcstrider` -> `Stalker` / DEX+WIS uncommon
   - Keep canonical names as the primary source of truth.
   - Return a clear report: `renamed`, `restatted`, `legacy_mapped`, `unmatched`.

2. **Fix the live item data**
   - Rename the 72 legacy rows in `items` to canonical archetypes while preserving IDs, slots, levels, inventory references, marketplace references, and loot references.
   - Recompute stats for **all common/uncommon equipment rows**, not just renamed rows, so stale L21/L41 stat blobs are replaced.
   - Keep unique, soulforged, consumables, and quest items untouched.

3. **Protect against this happening again**
   - Update the admin/tool docs and memory to list the legacy alias policy.
   - Update the Game Manual if needed so it only shows the current canonical names.
   - Keep the rewrite tool capable of repairing old names if more legacy rows appear later.

4. **Validate after repair**
   - Query live `items` after the update to confirm:
     - No `Arcstrider`, `Bardic`, `Enlightened`, `Ironroot`, or `Tyrant` rows remain.
     - Sanctified rows use WIS/CON/INT with WIS dominant.
     - Common/uncommon equipment has no HP filler.
     - Known canonical archetypes have expected attribute keys and dominance.

## Technical notes

- This is a **data repair plus edge-function hardening** task, not a schema migration.
- Data updates should use the existing `items` table only.
- No database structure changes are needed.
- Existing item IDs must stay stable so player inventory and loot references remain valid.