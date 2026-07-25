## Goal

Merge the "Telegraphed Boss Cast" and "Stored Power (Phase 2)" sub-sections into a single Boss Cast card in the admin creature form, and remove the `amount` vs `base_amount` drift that caused Thrum's Granite Slam to deal 7 instead of ~30.

## What "2 cards" means today

`src/components/admin/CreatureManager.tsx` (~lines 705–852) renders one bordered container that visually splits into two labeled sections:

1. **Telegraphed Boss Cast** — emoji, label, `amount` (labeled "Damage (flat)"), chance, cast ticks, cooldown, lock ticks.
2. **Stored Power (Phase 2)** — `base_amount`, `base_aoe_amount`, `primary_share`, `aoe_share`, `stored_power.cap`.

The resolver (`encounter_boss_resolve_cast`) uses `base_amount` + `used × primary_share`. The legacy `amount` field is written to the DB but ignored on resolve, so admins tuning "Damage (flat) = 30" see near-zero damage in practice.

## Unified design

One card titled "Boss Cast", no internal split. Fields, in order:

- Enabled toggle
- Emoji, Label
- **Flat damage (primary)** — writes both `amount` (kept for backwards compat / display) and `base_amount`
- **Flat damage (AoE, non-primary targets)** — writes `base_aoe_amount`; helper text notes it only matters when `aoe_share > 0` or when other party members are on the node
- Chance per tick, Cast ticks, Cooldown, Lock ticks
- **Stored Power cap** — with helper text "0 = no cap"
- **Primary share** — helper text "0–1 of the accumulated pool applied to the tank/primary target"
- **AoE share** — helper text "0–1 of the accumulated pool applied to other party members"

Short intro paragraph above the fields explains the combined behavior in one sentence: "While channeling, the boss pauses auto-attacks and stores the mitigated damage into a pool. On resolve, primary target takes `Flat + pool × primary_share`, others take `Flat AoE + pool × aoe_share`."

## Data / server changes

1. **Form state consolidation** in `CreatureManager.tsx`:
   - Remove the separate "Damage (flat)" input; the new "Flat damage (primary)" input drives both `boss_cast_amount` and `boss_cast_base_amount` in state.
   - On load, if `base_amount` is null/0 but `amount > 0`, seed both from `amount` so existing bosses open in a consistent state.
   - On save, always write `amount = base_amount` in the JSONB so the two never drift again.

2. **One-time SQL migration**: for every boss where `boss_cast.base_amount` is null or 0 and `boss_cast.amount > 0`, set `base_amount = amount`. Leave `base_aoe_amount` alone (defaults to 0). No schema change.

3. **Server fallback in `combat-tick`** (~line 2202 of `supabase/functions/combat-tick/index.ts`):
   ```
   base_amount: cfg.base_amount ?? cfg.amount ?? 0
   ```
   so any future boss configured with only the legacy field still resolves to flat damage.

## Verification

- Open Thrum in the admin: single card, "Flat damage (primary) = 30" prefilled, Stored Power fields visible below.
- Trigger a cast in-game: `Granite Slam strikes … [~30 + pool]` in the combat log.
- Aureth-style bosses (high stored-power accumulation) keep their current profile — cap, shares, and accumulation math are untouched.

## Not in scope

- No changes to accumulation math, cap enforcement, or level scaling (still flat).
- No changes to combat log copy, tooltips, or the game manual.
- No changes to the encounter/cast tables or RPCs beyond the fallback in `combat-tick`.