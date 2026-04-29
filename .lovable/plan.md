# Combat & Renown Cleanup — Findings & Minimal Patch Plan

## TL;DR

A full audit shows **the codebase is already in the desired state for ~95% of this request**. Prior refactors removed Focus Strike, the `CLASS_ATK` / `CLASS_COMBAT_PROFILES` / `TWO_HANDED_DAMAGE_MULT` constants, and the player-facing BHP / Boss Hunter wording. Only a small set of stale comments and a couple of manual polish items remain.

This plan only does what's actually missing. No behavior changes, no migrations, no formula changes.

---

## Audit Results

### Already done (verified — zero matches in source)
- `focus_strike` / `Focus Strike` / `focusStrikeBuff` — **0 matches**
- `CLASS_ATK` / `CLASS_COMBAT_PROFILES` / `TWO_HANDED_DAMAGE_MULT` — **0 matches**
- Player-facing "BHP" / "Boss Hunter Points" / `🏋️` — **0 matches in `src/`**
- Autoattacks already use `WEAPON_VERBS` first, then a neutral class fallback (no fireball/smite verbs)
- `combat-text.ts` already carries the "spell-class override removed" note
- `useCharacter.ts`, `interpretCombatTickResult.ts`, `RenownTrainerPanel.tsx`, `combat-tick/index.ts` (line 1103) already have the `// bhp is legacy storage for current Renown balance` comments
- All UI labels (CharacterPanel, StatusBarsStrip, RenownTrainerPanel, NodeView, MapPanel, GameManual) say "Renown" / "RP"
- DB columns `bhp` / `bhp_trained` are intentionally kept — already the documented policy

### Remaining stale references (the only things to fix)

| # | File | Line | Current | Action |
|---|------|------|---------|--------|
| 1 | `supabase/functions/combat-tick/index.ts` | 449 | `// Push canonical event lines (kill / BHP / salvage)` | Rename `BHP` → `Renown` in comment |
| 2 | `supabase/functions/combat-catchup/index.ts` | 373 | `// XP/gold/salvage/BHP atomically and the next combat-tick / refetch` | Rename `BHP` → `Renown` in comment |
| 3 | `supabase/migrations/20260425115634_*.sql` | header | `-- Add BHP to award_party_member so combat-catchup can grant boss-hunter-points` | **Leave as-is** — migrations are immutable history |
| 4 | `src/components/admin/GameManual.tsx` | ~1099-1180 | Renown section is good but doesn't mention the new combat model | Add 2-3 lines: "Autoattacks scale from your weapon die + STR. Class identity comes from abilities, not basic attacks." |

That's the entire diff.

---

## Patch Plan

### 1. Stale comments (server-side only, comment-only)
- `supabase/functions/combat-tick/index.ts` line 449 — `BHP` → `Renown`
- `supabase/functions/combat-catchup/index.ts` line 373 — `BHP` → `Renown`

### 2. Game Manual addition
In `src/components/admin/GameManual.tsx`, add a short "Combat Basics" blurb (or extend the existing Combat section) covering:
- Autoattack damage = `1d{weaponDie} + STR mod`
- Two-handed weapons get a larger die (no separate multiplier)
- Class no longer affects autoattack dice — class identity lives in abilities (e.g. Wizard Fireball, Warrior Power Strike)

If a Combat accordion item already exists I'll extend it; otherwise I'll add a new `combat-basics` `AccordionItem` adjacent to the existing Combat content. (Will check during implementation.)

### 3. Final search sweep
After edits, re-run:
```
rg -ni "focus.strike|class_atk|class_combat_profiles|two_handed_damage_mult|boss.hunter" src/ supabase/functions/
rg -n "\bBHP\b" src/ supabase/functions/
```
Confirm the only `bhp` matches left are intentional (DB column accesses + the legacy-storage comments).

---

## Out of Scope (per request)
- No DB migrations
- No rename of the `bhp` / `bhp_trained` columns
- No combat balance, formula, or reward changes
- No client/server contract changes
- No new systems

---

## Risk
Effectively zero. Two comment edits and one documentation addition.
