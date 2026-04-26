## Audit findings — Bard's Inspire

Inspire is currently dead code:
- `useCombatActions.ts` (line 218–221) — the `regen_buff` branch only logs `"plays an inspiring song!"` and the comment explicitly says "Inspire no longer grants a regen multiplier (removed in regen overhaul)".
- No state is set, no buff is gathered, no icon is rendered, no party broadcast is sent. The CP cost is not even charged because the function returns before the cost block (need to verify, but effectively the player gets nothing).
- `GameManual.tsx` and `class-abilities.ts` still describe it as "2× HP & CP regen for 90s" — stale.
- Regen itself is fully client-side in `useGameLoop.ts` (skipped while `inCombatRegenRef` is true). HP regen formula is `Math.floor(conRegen + eqItemRegen + foodRegen + milestoneHpFlat + innFlat)`. CP regen is `Math.floor(intRegen + foodCpRegen + milestoneCpFlat + innFlat)`. Combat-tick (server) does not touch regen.

So an Inspire buff is naturally a non-combat regen booster — meaningful between fights, while exploring, and during downtime.

## Proposal

Yes, scaling duration with INT (Bard's other primary stat alongside CHA) makes sense and is consistent with how other classes' buffs use a primary stat for magnitude and a secondary stat for duration (e.g. Wizard's Arcane Surge uses INT for duration; Battle Cry uses DEX for duration).

### New Inspire mechanics

- **Magnitude (CHA-based, additive flat regen):**
  - `chaMod = max(0, statModifier(cha + gear cha))`
  - `bonusHpRegen = max(2, chaMod + 2)` — added flat to the HP regen tick
  - `bonusCpRegen = max(1, ceil(chaMod / 2) + 1)` — added flat to the CP regen tick
  - Applied on top of existing food/inn/milestone bonuses (additive, not multiplicative).
- **Duration (INT-based):**
  - `intMod = max(0, statModifier(int + gear int))`
  - `durationMs = clamp(60_000 + intMod * 8_000, 60_000, 180_000)` — 60s floor, 3 min cap.
  - Examples: INT 10 → 60s, INT 14 → 76s, INT 18 → 92s, INT 22 → 108s.
- **Cost:** 15 CP (unchanged).
- **Targets:** self + same-node party members (mirrors Crescendo wiring — broadcast over `party_regen_buff`-style channel to a new event, OR reuse a generic buff channel — see below).

### Buff icon

Add an "Inspire" entry to the buff strip in `StatusBarsStrip.tsx` (and the larger Character Panel `ActiveBuffs`):
- Emoji: 🎶
- Color: `text-elvish` (matches party/song aesthetic), bg `bg-elvish/15`.
- Detail: `+{bonusHpRegen} HP/4s, +{bonusCpRegen} CP/4s`.
- Progress bar pct from `(expiresAt - now) / actualDurationMs` — store `durationMs` on the buff so the bar fills correctly when INT-scaled.

### Party visibility

Broadcast Inspire to same-node party members so allies also receive the regen and see the icon. Add a new broadcast event `party_inspire_buff` on the party channel (parallel to `party_regen_buff`) with payload `{ hp_per_tick, cp_per_tick, expires_at, duration_ms, caster_id }`. Wired the same way Crescendo is in `usePartyBroadcast.ts` and `GamePage.tsx`.

## Technical changes

1. **`src/features/combat/hooks/useGameLoop.ts`**
   - Add `InspireBuff` interface: `{ hpPerTick: number; cpPerTick: number; expiresAt: number; durationMs: number; casterId: string }`.
   - Add `inspireBuff` state + setter via `useBuffState`.
   - In the unified regen `setInterval`, when an active Inspire is present add `inspireBuff.hpPerTick` to HP regen and `inspireBuff.cpPerTick` to CP regen (still gated by `!inCombatRegenRef.current`, matching existing regen behavior).
   - Use a ref to avoid stale closure (same pattern as `foodBuffRef`).

2. **`src/features/combat/hooks/useBuffState.ts`**
   - Add `inspireBuff` to `BuffState` / `BuffSetters` and `useState<InspireBuff | null>(null)`.

3. **`src/features/combat/hooks/useCombatActions.ts`** (lines 218–221)
   - Replace the no-op `regen_buff` branch with:
     - Compute `chaMod`, `intMod`, `bonusHpRegen`, `bonusCpRegen`, `durationMs`.
     - `setInspireBuff({ hpPerTick, cpPerTick, expiresAt: now + durationMs, durationMs, casterId: character.id })`.
     - Log `"🎶 {name} plays an inspiring song! (+X HP/+Y CP regen for Zs)"`.
   - Note: CP cost deduction must happen for this branch — verify the existing cost-deduction path covers `regen_buff` (looks like the early-return at line 220 may have been bypassing it; will fix if needed).

4. **`src/features/character/components/StatusBarsStrip.tsx`**
   - Add `inspireBuff?` prop.
   - Add buff card in `ActiveBuffs` using stored `durationMs` for the progress bar.

5. **`src/features/character/components/CharacterPanel.tsx`**
   - Add `inspireBuff` to the `ActiveBuffs` larger view (mirrors Crescendo entry).
   - Show Inspire contribution in the HP Regen / CP Regen tooltip breakdown (`+X Inspire`).

6. **`src/features/party/hooks/usePartyBroadcast.ts`**
   - Add `party_inspire_buff` event handler + `broadcastInspireBuff` sender (mirrors `broadcastPartyRegenBuff`).
   - Skip self-echo via `caster_id === characterId`.

7. **`src/pages/GamePage.tsx`**
   - Wire `incomingInspireBuff` → `setInspireBuff` (filtered to same-node members, like Crescendo broadcast does implicitly via the party channel scope).
   - Send `broadcastInspireBuff` when local Inspire buff is set (mirror of Crescendo broadcaster around line 508–513).
   - Pass `inspireBuff` into `StatusBarsStrip` and `CharacterPanel`.

8. **`src/features/combat/utils/class-abilities.ts`**
   - Update Inspire description to reflect new behavior: `"Inspires you and your party — boosts HP/CP regen by an amount based on your Charisma, for a duration scaling with Intelligence"`.

9. **`src/components/admin/GameManual.tsx`** (line 734)
   - Update copy: `"Inspire (T1, 15 CP): +CHA-scaling flat HP & CP regen, duration scales with INT (60–180s)"`.

10. **`mem://game/class-abilities/`**
    - Add a small `bard.md` memory documenting Inspire's stat scaling so future sessions don't drift back to the doubled-regen model.

## What this does NOT change

- Combat-tick / server regen authority (still no server regen — remains client-side, gated by `inCombatRegenRef`).
- Inspire still does nothing during active combat (HP/CP regen is suppressed during combat by design — `combat-tick` is sole HP writer). The buff icon and timer keep ticking, so it remains useful immediately after combat ends.
- Other Bard abilities (Dissonance, Crescendo, Grand Finale).
