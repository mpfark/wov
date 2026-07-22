
## Goal

1. Stop rendering the Order roster in the middle of the node panel. Instead, players learn the roster by talking to an NPC at the Order Hall.
2. Regroup the `service_role` list so guild/order roles are visually together and trade/craft roles are together in every dropdown/icon strip.

## 1. Roster becomes an NPC service

Two viable shapes — recommend **Option A**:

- **Option A (recommended): extend the existing `recruiter` role.** The recruiter already lives at the class hall (bond/join flow). Add a "View roster" action to their dialog. No new enum value, no new admin plumbing, no new AI generator branch. The recruiter panel already knows the `class_hall`.
- **Option B: new `roster_keeper` (or `loremaster`) role.** Cleaner separation, but adds a new enum value, admin option, AI generator branch, and yet another NPC to place in every hall.

Plan assumes Option A. If you'd rather have a distinct NPC, say so and I'll switch to B.

### Changes for Option A

- `src/features/world/components/NodeView.tsx`
  - Remove the `OrderRosterPanel` render (lines 264–266) and its import.
  - When a `class_hall` node has no `recruiter` NPC, keep the current "no recruiter on duty" hint so admins notice.
- `src/features/character/components/OrderRecruiterDialog.tsx` (the recruiter's talk panel)
  - Add a collapsible "Roster by renown" section that reuses the existing `get_order_roster` RPC + the visual from `OrderRosterPanel` (highlight self, rank, level/class, bond).
  - Section closed by default so first-time talkers still see bond/join actions first.
- `src/features/world/components/OrderRosterPanel.tsx`
  - Keep the file (recruiter dialog reuses its markup) or inline the JSX into the dialog and delete the file. I'll inline + delete unless you'd prefer the shared component.

Nothing changes server-side. The `get_order_roster` RPC and `class_bond` logic stay as-is.

## 2. Regroup service roles

Today the enum order is roughly: `vendor, blacksmith, jewelcrafter, trainer, recruiter, heraldry`. Proposed presentation grouping (enum values unchanged — reordering the DB enum is disruptive and not needed for UX):

```text
Order & Lineage        Trade & Craft
  🏰 Recruiter           🪙 Vendor
  📜 Herald              🔨 Blacksmith
  🏛️ Renown Trainer      💎 Jewelcrafter
```

Applied consistently in:

- `src/components/admin/NPCManager.tsx` — service filter dropdown (line 250-ish) and the edit-form service_role select (line 337-ish). Add non-selectable group headers ("— Order & Lineage —", "— Trade & Craft —") using shadcn `SelectGroup`/`SelectLabel`.
- `src/components/admin/NodeEditorPanel.tsx` — the `roleConfigs` list (line 1324) and the flag checkboxes (`is_vendor`, `is_blacksmith`, `is_jewelcrafter`, `is_trainer`, `is_heraldry`) rendered in the same two-group order. Add a small heading above each group.
- `src/features/world/components/NodeView.tsx` — the NPC talk-button list (lines 426–438). Sort NPCs so order/lineage roles render before trade/craft, keeping non-service NPCs after both.
- `src/features/world/utils/service-registry.ts` — reorder `SERVICES` so adjacency descriptions read Order/Lineage first, Trade/Craft second, then the "environment" flags (`is_inn`, `is_teleport`, `is_soulforge`, `is_stonebinder`). This flows into `describeAdjacentLandmarks`.

No enum, migration, or RPC changes.

## Technical notes

- `class_hall` on a node is what makes the recruiter meaningful; the roster section only renders inside the recruiter dialog and only when `class_hall` is set — same guard as today.
- If Option B is picked later, we'd add a new value to the `npcs.service_role` check (string column, no PG enum — safe), a `roleLabel` branch in `ai-generate-service-npc`, and an admin toggle. Straightforward, just more surface.

## Out of scope

- No changes to bonding math, roster RPC, or renown formulas.
- No visual redesign of the recruiter dialog beyond adding the collapsible roster section.
