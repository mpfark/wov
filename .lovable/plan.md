

# Combat System Reliability Refactor

## Current State

The shared `combat-resolver.ts` module already exists and is used by both `combat-tick` and `combat-catchup`. The `active_effects` table is the source of truth. The `combat-tick` already returns actual active effects when 0 ticks are processed. No legacy `combat_sessions.dots` references remain in server code.

What remains: TypeScript strictness, deterministic tests, one stale comment in client code, and a duplicated kill-reward block in `combat-tick`.

---

## Plan

### 1. Enable stricter TypeScript checks

**File: `tsconfig.app.json`**
- Set `"noUnusedLocals": true` and `"noUnusedParameters": true`
- Add `"typecheck": "tsc --noEmit"` script to `package.json`
- Fix resulting errors (prefix unused params with `_`, remove dead variables) in combat-related files

### 2. Extract duplicated kill-reward logic in combat-tick

**File: `supabase/functions/combat-tick/index.ts`**

Lines 724-796 duplicate the XP/gold/salvage/BHP reward logic already in `handleCreatureKill` (lines 290-371). The DoT-kill handler manually recalculates everything instead of calling `handleCreatureKill`. Refactor the DoT-kill loop (lines 724-796) to call `handleCreatureKill` directly, since the resolver already marks kills in `cKilled` — just need to skip the `cKilled.add()` that `handleCreatureKill` does (it's already there, harmless to re-add to a Set).

This eliminates ~70 lines of duplicated reward code within the same file.

### 3. Clean up stale comment

**File: `src/hooks/useActions.ts` line 414**
- Update the comment referencing "DoT drain mode" to reference the actual architecture: effects persist in `active_effects` and are resolved by `combat-catchup` on node re-entry.

### 4. Add deterministic combat resolver tests

**New file: `src/test/combat/combat-resolver.test.ts`**

Import `resolveEffectTicks` from the shared resolver (copy the pure function for client-side testing since the Deno import path won't work in Vitest — mirror the function or use a shared export).

**Approach**: Create a thin copy of `resolveEffectTicks` at `src/lib/combat-resolver.ts` that re-exports the same pure logic for client-side testing. The edge functions continue importing from `_shared/`. Both files share identical logic — this is acceptable because `resolveEffectTicks` is pure (no DB calls).

Tests to write:
- Single DoT tick applies correct damage
- Multiple ticks processed in bulk mode
- Effect expires after `expires_at`
- Creature dies from DoT damage (HP reaches 0)
- Tick cap limits maximum ticks processed
- Bleed uses flat `damage_per_tick`, poison/ignite use `stacks * damage_per_tick`
- Already-dead creatures are skipped
- `advancedEffects` correctly advances `next_tick_at`

All tests use fixed inputs — no randomness.

### 5. Update resolver documentation

**File: `supabase/functions/_shared/combat-resolver.ts`**
- Add a header block explaining the architecture: `active_effects` is sole source of truth, time advances deterministically, server is authoritative
- Document why both single-tick and bulk modes exist

---

## Files Modified

| File | Change |
|------|--------|
| `tsconfig.app.json` | Enable `noUnusedLocals`, `noUnusedParameters` |
| `package.json` | Add `typecheck` script |
| `supabase/functions/combat-tick/index.ts` | Deduplicate DoT-kill rewards (~70 lines removed) |
| `src/hooks/useActions.ts` | Fix stale "DoT drain mode" comment |
| `src/lib/combat-resolver.ts` | New: client-side copy of pure resolver for testing |
| `src/test/combat/combat-resolver.test.ts` | New: 8+ deterministic tests |
| `supabase/functions/_shared/combat-resolver.ts` | Enhanced documentation header |
| Various `src/` files | Fix unused variable/parameter errors from stricter TS |

## Constraints

- Zero gameplay changes — same damage, timing, rewards
- No changes to `combat-catchup` (already clean)
- Edge function resolver remains the authoritative copy

