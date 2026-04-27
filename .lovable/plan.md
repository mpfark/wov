## Goal

Make recasting Bard's Inspire while it's already active behave predictably: **refresh the timer, keep the best-of stats**. Update tooltips and docs to match.

## Behavior spec

When a Bard casts Inspire:

- If no Inspire buff is active (none, or expired): apply the new buff as today (timer = new `durationMs`, stats from current CHA/INT).
- If an Inspire buff from any caster is currently active:
  - `hpPerTick = max(existing.hpPerTick, new.hpPerTick)`
  - `cpPerTick = max(existing.cpPerTick, new.cpPerTick)`
  - `expiresAt = now + new.durationMs` (always reset to the new full duration; never shrink — but since duration is INT-scaled per cast, this is simply the new caster's duration)
  - `durationMs` stored on the buff = the actual remaining-window length (so the icon's progress bar fills correctly — see Technical note below)
  - `casterId` set to the new caster (so broadcast logic still attributes the latest cast)
- Costs always charged on cast (no "free re-cast" exploit).
- Combat log line distinguishes refresh vs new application:
  - New: `🎶 {name} plays an inspiring song! (+X HP & +Y CP regen for Zs)`
  - Refresh: `🎶 {name} renews the inspiring song! (+X HP & +Y CP regen, Zs remaining)`

This applies symmetrically to party members receiving the broadcast: incoming `party_inspire_buff` events use the same merge rule, so a stronger Bard's buff is never overwritten by a weaker ally's recast.

## Tooltip / doc copy

- **Ability description** (`class-abilities.ts`): add a sentence — `"Recasting refreshes the duration and keeps the stronger regen values."`
- **Game Manual entry** (`GameManual.tsx` line 734): append `"Recast to refresh — keeps the stronger HP/CP regen values."`
- **Memory** (`mem://game/class-abilities/bard.md`): update the "Refreshes (does not stack)" line to "Refreshes on recast — keeps the best-of HP/CP regen across casts; timer always resets to the new caster's duration."

## Technical changes

1. **`src/features/combat/hooks/useCombatActions.ts`** (regen_buff branch, lines 218–234)
   - Replace the unconditional `setInspireBuff({...})` with a functional updater that merges with the previous buff:
     ```ts
     const now = Date.now();
     const newDuration = Math.min(180_000, Math.max(60_000, 60_000 + intMod * 8_000));
     const newHp = Math.max(2, chaMod + 2);
     const newCp = Math.max(1, Math.ceil(chaMod / 2) + 1);

     p.buffSetters.setInspireBuff(prev => {
       const stillActive = prev && prev.expiresAt > now;
       const mergedHp = stillActive ? Math.max(prev!.hpPerTick, newHp) : newHp;
       const mergedCp = stillActive ? Math.max(prev!.cpPerTick, newCp) : newCp;
       return {
         hpPerTick: mergedHp,
         cpPerTick: mergedCp,
         expiresAt: now + newDuration,
         durationMs: newDuration,
         casterId: p.character.id,
       };
     });
     ```
   - Use a captured `wasActive` boolean (computed before the setter, by reading the latest state via a ref already exposed for log purposes — or simply re-derive from `Date.now()` and the buff prior to the call by reading from `p.buffSetters` if exposed; otherwise pass a flag through the log message based on a synchronous read of `buffSetters`/state).
   - For the log message, check `p.character` doesn't expose buff state; the simplest approach: do a synchronous pre-check by reading the current buff from the buff state hook. Since `useCombatActions` already destructures `p.buffSetters`, expose `inspireBuff` (current value) on `p` (mirroring how other buffs are passed for cost/ability gating). Use it to choose new vs. renew log copy.

2. **`src/pages/GamePage.tsx`** — apply same merge for incoming party broadcasts (around line 508):
   ```ts
   if (!incomingInspireBuff) return;
   buffSetters.setInspireBuff(prev => {
     const now = Date.now();
     const stillActive = prev && prev.expiresAt > now;
     if (!stillActive) return incomingInspireBuff;
     return {
       hpPerTick: Math.max(prev!.hpPerTick, incomingInspireBuff.hpPerTick),
       cpPerTick: Math.max(prev!.cpPerTick, incomingInspireBuff.cpPerTick),
       expiresAt: incomingInspireBuff.expiresAt,
       durationMs: incomingInspireBuff.durationMs,
       casterId: incomingInspireBuff.casterId,
     };
   });
   ```
   Note the broadcast self-echo gate (`prevInspireBuffRef`) needs to keep working — re-broadcast should not loop because the broadcaster only fires when `casterId === character.id`, which incoming buffs won't satisfy.

3. **`src/features/combat/utils/class-abilities.ts`** (line 55) — append the recast sentence to Inspire's `description`.

4. **`src/components/admin/GameManual.tsx`** (line 734) — append the recast sentence.

5. **`mem://game/class-abilities/bard.md`** — update line 13 to describe best-of merge.

## Out of scope

- No DB / edge-function changes (Inspire remains client-side regen, suppressed in combat).
- No UI changes to the buff strip / Character Panel — they already render `hpPerTick` / `cpPerTick` / `durationMs` from the merged buff and will display the merged values automatically.
- No change to costs, broadcast event shape, or party wiring.

## Files to modify

- `src/features/combat/hooks/useCombatActions.ts`
- `src/pages/GamePage.tsx`
- `src/features/combat/utils/class-abilities.ts`
- `src/components/admin/GameManual.tsx`
- `mem://game/class-abilities/bard.md`
