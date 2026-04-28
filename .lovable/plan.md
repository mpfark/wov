# Renown Trainer → Service Panel + Leaderboard

Bring the Renown Trainer in line with the other service hubs (Vendor, Blacksmith, Teleport, Marketplace): a unified `ServicePanelShell` window with tabs, an NPC service-role for proper "Talk to" framing, and a new **Renown Leaderboard** tab listing top wayfarers by lifetime Renown.

## What the player sees

1. Walking into a `is_trainer` node, the trainer NPC appears in the "In the Area" list with a 🏛️ icon and a **Train** button (just like Vendor/Blacksmith).
2. Clicking **Train** (or the existing 🏛️ shortcut on the action bar) opens a parchment-style window with two tabs:
   - **Train** — current trainer UI (stat list, ranks, costs, success chance, Train buttons), framed by the NPC's name and dialogue as the subtitle.
   - **Leaderboard** — a ranked list of the top 25 characters by lifetime Renown (`rp_total_earned`), showing rank, name, level, class, and total RP. The viewer's own row is highlighted; if they're outside the top 25, their own rank is appended at the bottom.
3. Layout matches the other service panels (fixed shell size, sticky tabs, scrollable body, parchment styling, wax-seal close).

## Backend changes

1. **Migration** — extend `npcs.service_role` check constraint from `('vendor', 'blacksmith')` to `('vendor', 'blacksmith', 'trainer')`. Existing rows untouched.
2. **`useNPCs` hook** — extend `NPCServiceRole` type to include `'trainer'`.
3. **Admin NPCManager** — add `service_role` field (already missing for vendor/blacksmith too — out of scope; only add `trainer` to whatever options exist). On inspection the manager doesn't currently surface `service_role` editing, so we add a small Select for `service_role` with options None / Vendor / Blacksmith / Trainer so admins can mark a trainer NPC.

## Frontend changes

### `RenownTrainerPanel.tsx` (rewrite)
- Replace the raw `Dialog` with `ServicePanelShell`:
  - `icon="🏛️"`, `title="Renown Trainer"`, `subtitle` = NPC name + flavor when provided (else default flavor).
  - `tabs` slot = `Tabs` with `Train` and `Leaderboard` triggers.
  - `singleColumn` body — render the active tab's content in the `left` slot.
- Accept new props: `npcName?: string`, `npcFlavor?: string`.
- **Train tab** — keep existing stat grid, Renown counter, level-30 gate, and `handleTrain` logic exactly as today (using the shared `getMaxHp/getMaxCp/getMaxMp` helpers already in place).
- **Leaderboard tab** — new component logic:
  - On open / tab switch, query `characters` for top 25: `select('id, name, level, class, rp_total_earned').order('rp_total_earned', { ascending: false }).limit(25)`.
  - Render as a numbered list with rank #, name, `Lv{level}` `{class}`, and RP total (right-aligned, dwarvish color).
  - Highlight the viewer's own row (`character.id === row.id`) with `border-primary bg-primary/10`.
  - If viewer not in top 25, run a second query to fetch their rank: count of characters with `rp_total_earned > viewer.rp_total_earned`, then append their row at the bottom under a divider.
  - Empty state via `ServicePanelEmpty` if no rows.

### `GamePage.tsx`
- Extend `handleTalkToNPC` to route `service_role === 'trainer'` (when `currentNode?.is_trainer`) to open the trainer panel and set `activeServiceNpc`.
- Pass `npcName` / `npcFlavor` into `<RenownTrainerPanel>` from `activeServiceNpc` when `service_role === 'trainer'`.
- Clear `activeServiceNpc` in trainer `onClose`, mirroring vendor/blacksmith.
- Keep the existing 🏛️ action-bar shortcut working (no NPC framing in that path).

### `NodeView.tsx`
- In the NPCs list, add `'trainer'` to the role icon/label switch: icon `🏛️`, button label `Train`.
- In the location header flag row, dim/highlight 🏛️ based on whether a `service_role === 'trainer'` NPC is present at the node (mirroring the vendor/blacksmith staffed-vs-unstaffed treatment).

## Out of scope

- No changes to training math, Renown award logic, or the `bhp` / `rp_total_earned` columns.
- No global RLS changes — the existing `characters` SELECT policy already lets any authenticated user read minimal fields needed for the leaderboard via party/admin paths; if it doesn't, we add a narrow leaderboard view RPC instead. We confirm during implementation; if blocked, fall back to a `SECURITY DEFINER` SQL function `get_renown_leaderboard(_limit int)` returning only `id, name, level, class, rp_total_earned`.
- No redesign of the trainer math UI.

## Files touched

- `supabase/migrations/<new>.sql` — relax `npcs_service_role_check`
- `src/features/creatures/hooks/useNPCs.ts` — extend `NPCServiceRole`
- `src/features/character/components/RenownTrainerPanel.tsx` — rewrite around `ServicePanelShell`, add Leaderboard tab
- `src/pages/GamePage.tsx` — route `trainer` service NPC, pass NPC framing props
- `src/features/world/components/NodeView.tsx` — NPC row icon/label + staffed flag
- `src/components/admin/NPCManager.tsx` — add `service_role` selector including `trainer`
