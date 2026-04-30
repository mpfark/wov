## The bug — CP appearing to regenerate during combat

Your warrior's CP "jumping up" mid-combat traces to a single line in the server tick handler.

### Root cause

`supabase/functions/combat-tick/index.ts` (line 380) seeds each member's working CP for the tick like this:

```ts
const dbCp = m.c.cp ?? 0;
const freshCp = (!party_id && m.id === character_id && typeof client_cp === 'number')
  ? Math.min(client_cp, m.c.max_cp ?? dbCp)   // ⚠️ takes client_cp as-is (capped only by max_cp)
  : dbCp;
mCp[member.id] = freshCp;
```

The intent was "use whichever CP is freshest" so that an ability cost the client just paid is honored. But the comparison is one-sided: **whenever `client_cp > dbCp`, the server adopts the higher client value** — and then writes it back to the row at the end of the tick (line 1151: `if (mCp[m.id] !== c.cp) updates.cp = mCp[m.id]`).

How `client_cp` ends up higher than `dbCp` mid-fight:

1. The 4-second client regen interval in `useGameLoop.ts` is gated by `inCombatRegenRef.current`, which mirrors React state `inCombat` via `useEffect`. There is a small window between `setInCombat(true)` running and the effect committing where the regen tick can fire and bump `character.cp` locally.
2. Bigger window: at the *very start* of combat (first creature aggros / first ability queued), the regen interval may have *just* run a moment before. Its `updateCharacter({ cp: newCp })` writes optimistically to local React state immediately but the DB write is async; the *next* combat tick fires with `client_cp = newCp` while `dbCp` is still the pre-regen value.
3. `Math.min(client_cp, max_cp)` then promotes that elevated value into the server-authoritative `mCp`, and the resulting `updates.cp` writes it to the DB. Bars visibly jump up.

This is the same class of bug we already fixed for HP (combat-tick is the sole writer for HP during combat). CP is currently leaking client-side regen into the authoritative row.

### Fix

Make combat-tick trust the DB for CP at the start of each tick — never take a *higher* value from the client:

```ts
// supabase/functions/combat-tick/index.ts ~line 380
const dbCp = m.c.cp ?? 0;
// Only honor client_cp when it's LOWER than dbCp (i.e. client paid an ability
// cost the server hasn't seen yet). Never adopt a higher client value — that
// would let stale client-side regen leak in during combat.
const freshCp = (!party_id && m.id === character_id && typeof client_cp === 'number')
  ? Math.min(client_cp, dbCp)
  : dbCp;
mCp[member.id] = freshCp;
```

That preserves the original safety net for ability-cost freshness while closing the upward leak.

### Optional belt-and-suspenders (low risk, recommended)

In `src/features/combat/hooks/useGameLoop.ts`, also suppress the *first* CP regen tick whenever combat just started by checking the React state `inCombat` directly (not just the ref). Today the ref is only flipped inside a `useEffect`, so the timing window described above exists. Simplest patch: when `usePartyCombat`'s `startCombatCore` flips `inCombatRef.current = true`, also call a passed-in `setInCombatRegen(true)` so the gating ref is flipped synchronously rather than via React's effect cycle. We already pass `inCombatRegenRef` out of `useGameLoop` — we can write to it directly from `startCombatCore` to remove the lag.

### Files to change

- `supabase/functions/combat-tick/index.ts` — flip the `Math.min(client_cp, max_cp)` to `Math.min(client_cp, dbCp)` (1 line).
- *(Optional)* `src/features/combat/hooks/usePartyCombat.ts` and `src/pages/GamePage.tsx` — flip `inCombatRegenRef.current` synchronously when combat starts, alongside `inCombatRef.current = true`.

### Verification

After the change, on your L8 warrior: enter a fight at full CP minus a small amount, watch the CP bar through the fight — it should only ever decrease (from abilities) or stay flat, never tick upward. Out of combat the 4-second regen continues working as before.
