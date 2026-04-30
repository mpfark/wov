# Trainer Service Panel — Unified Attribute Services

Move all attribute-related actions out of the Character Panel and into a single trainer service panel, available only at trainer nodes. This makes "visiting a trainer" a meaningful loop, alongside vendors, blacksmiths, and the marketplace.

## What changes for players

- **Spending level-up points**: no longer possible from the Character Panel. Players must travel to a trainer node.
- **Respec (spending respec points)**: same — handled at the trainer.
- **Renown training**: continues to live at trainer nodes (unchanged location).
- The Character Panel still **shows** unspent points and the current attributes, but the `+` controls and "Plan stats" button are removed (replaced with a hint: *"Visit a trainer to spend your points."*).

## New trainer panel layout

Reuse `ServicePanelShell` (matches Vendor / Blacksmith / Marketplace look) with three tabs:

```text
┌───────────────────────────────────────────┐
│  🏛️  Renown Trainer                       │
│  "<NPC flavor line>"                      │
│  ── ✦ ──                                  │
│  [ Allocate ] [ Respec ] [ Renown ] [Board]│
├───────────────────────────────────────────┤
│  (tab content)                            │
└───────────────────────────────────────────┘
```

Tabs:
1. **Allocate** — embedded StatPlanner UI (planner UX preserved: plan, preview deltas, commit). Disabled state when `unspent_stat_points === 0`.
2. **Respec** — current refund-one-point-at-a-time flow from `useStatAllocation.refundStat`. Disabled when `respec_points === 0`.
3. **Renown** — the existing Train UI from `RenownTrainerPanel` (cost / chance / per-stat rows). Unchanged.
4. **Leaderboard** — existing leaderboard tab.

Renaming: panel title becomes simply **"Trainer"** (the NPC dialogue still mentions Renown).

## Files to change

**New:**
- `src/features/character/components/TrainerPanel.tsx` — replaces `RenownTrainerPanel`. Hosts the four tabs, accepts `character`, `equipmentBonuses`, `updateCharacter`, `addLog`, `npcName`, `npcFlavor`.
- Internal sub-components for Allocate/Respec tabs (or inline) — they reuse the math from `StatPlannerDialog` and `useStatAllocation`.

**Edited:**
- `src/pages/GamePage.tsx` — swap `RenownTrainerPanel` import for `TrainerPanel`; pass `equipmentBonuses` (already computed for CharacterPanel).
- `src/features/character/components/CharacterPanel.tsx` — remove the `+` stat buttons, the inline planner CTA, and the `StatPlannerDialog` mount. Replace with a small parchment hint when there are unspent or respec points: *"You feel restless — a Trainer can guide your growth."* Keep showing "X stat points" / "X respec points" badges so players know to travel.
- `src/features/character/hooks/useStatAllocation.ts` — keep as-is (still used by the new panel's tabs).
- `src/features/character/components/StatPlannerDialog.tsx` — keep its math/preview helpers but extract the body into a reusable `<StatPlannerBody>` so both the trainer Allocate tab and (optionally) admin tools can share it. The `<Dialog>` wrapper version is removed from the player flow.
- `src/components/admin/GameManual.tsx` — short note that attribute training and respec are trainer-only services.

**Deleted (after migration):**
- `src/features/character/components/RenownTrainerPanel.tsx` — superseded by `TrainerPanel.tsx`.

## Behavior notes

- All actions remain **client-driven** through the existing `updateCharacter` path; no new RPC, no schema change.
- Combat lock: the trainer panel respects the same "no service panels in combat" rule as Vendor/Blacksmith (closed if combat starts).
- `npcName` / `npcFlavor` from a service-role NPC still flow through unchanged.
- Empty-state copy uses `<ServicePanelEmpty>` for consistency (e.g. *"You have no unspent points to allocate."*).

## Out of scope

- No DB migrations.
- No changes to how points are awarded by `combat-tick` (level-up rewards).
- No changes to the Renown training math, costs, or success curve.
- Inn nodes do **not** become trainers — strict trainer-only gating.
