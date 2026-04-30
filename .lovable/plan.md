## Goal

Add a new **Templar** class — a sword-and-shield holy defender — with a class-specific ability set that reuses existing combat systems (member buffs, shield block, `applyCreatureHit` pipeline, party tick loop, `active_effects` rows for the consecrate ground effect).

No new tables. No new ability `type` values are strictly required for primitives we already have, but four new `type` strings are introduced for dispatch clarity (`reactive_holy`, `block_buff`, `consecrate`, `mitigation_buff`).

---

## 1. Register the Templar class

Update **`src/shared/formulas/classes.ts`** (and mirror byte-for-byte in **`supabase/functions/_shared/formulas/classes.ts`**):

- `CLASS_BASE_HP.templar = 22` (between warrior 24 and ranger 20)
- `CLASS_BASE_AC.templar = 12` (matches warrior — shield-tanky)
- `CLASS_LEVEL_BONUSES.templar = { wis: 1, con: 1 }` (defensive + WIS scaling)
- `CLASS_LABELS.templar = 'Templar'`
- `CLASS_WEAPON_AFFINITY.templar = ['sword', 'mace']` (holy sword/mace)
- `CLASS_COMBAT_PROFILES.templar = { stat: 'wis', diceMin: 1, diceMax: 8, critRange: 20, emoji: '✝️', verb: 'smites with righteous steel' }`
- `CLASS_CRIT_RANGE.templar = 20`

Update **`src/lib/game-data.ts`**:

- Add Templar to `CLASS_STATS` (suggested `{ str: 1, dex: 1, con: 2, int: 0, wis: 3, cha: 0 }`)
- Add a `CLASS_DESCRIPTIONS.templar` blurb.

Update **`src/features/combat/utils/class-abilities.ts`**:

- Add `CLASS_COMBAT.templar` entry for the T0 autoattack profile.
- Add `CLASS_ABILITIES.templar = [...]` (see ability set below).
- Extend the `ClassAbility['type']` union with the four new strings.

Update **`src/components/admin/GameManual.tsx`** with a Templar entry mirroring the other classes' format.

---

## 2. Ability set

T0 — **Judgment** (cpCost 10, level 1, type `'smite'` reused from healer's smite handler — single-target WIS-scaling damage). Uses the existing `smite` server handler — zero new code.

| # | Name | cpCost | Lvl | New `type` | Effect |
|---|---|---|---|---|---|
| 1 | Holy Shield | 15 | 5 | `reactive_holy` | When hit, attacker takes `2 + WIS_mod * 2` holy damage (max 1 trigger per creature per tick). 30s buff. |
| 2 | Shield Wall | 25 | 10 | `block_buff` | Block chance forced to 100% for next **2 ticks** (~4s). Requires shield equipped. |
| 3 | Consecrate | 40 | 15 | `consecrate` | Node-wide ground effect for **3 ticks**: heals each living party member on node for `3 + WIS_mod * 2` and deals `2 + WIS_mod` holy damage to engaged creature(s). |
| 4 | Divine Challenge | 60 | 20 | `mitigation_buff` | Templar takes 30% less damage for 30s. Pure DR — no aggro/taunt. |

All abilities scale with WIS. None read weapon damage.

---

## 3. Server implementation (`supabase/functions/combat-tick/index.ts`)

All four abilities are dispatched in the existing ability handler section (where `damage_buff`, `absorb_buff`, `battle_cry_dr`, `dot_debuff` live). They store state on the `buffs[member.id]` map (the `member_buffs` JSONB column on the combat session) — **no schema changes**.

### a. Holy Shield (`reactive_holy`)
- On cast: `buffs[m.id].reactive_holy = { damage_per_hit: 2 + wisMod*2, expires_at: now + 30000 }`.
- Inside `applyCreatureHit` (after damage is applied, when `quality !== 'miss'`): if attacker creature is alive and target has `reactive_holy` active and not yet triggered against this creature **this tick**, subtract from `cHp[creature.id]` and emit a `holy_reflect` event. Use a per-tick `Set<creatureId>` keyed by `${targetId}:${creatureId}` to enforce the once-per-tick cap.

### b. Shield Wall (`block_buff`)
- On cast: `buffs[m.id].block_buff = { force_block: true, expires_tick: currentTick + 2 }`.
- Inside `applyCreatureHit`'s shield-block step: if `mb.block_buff?.force_block && mb.block_buff.expires_tick > currentTick` and `hasShield`, treat block roll as guaranteed.
- At end of each tick, decrement / clear when `expires_tick <= currentTick`.

### c. Consecrate (`consecrate`)
- On cast: `buffs[m.id].consecrate = { heal_per_tick: 3 + wisMod*2, dmg_per_tick: 2 + wisMod, ticks_remaining: 3 }`.
- At the start of each tick (before auto-attacks), iterate members with active consecrate; for each: heal every living party member at the same `node_id` (clamped to max HP), and deal `dmg_per_tick` holy damage to each engaged creature. Emit `consecrate_pulse` events. Decrement `ticks_remaining`; clear at 0.

### d. Divine Challenge (`mitigation_buff`)
- On cast: `buffs[m.id].mitigation_buff = { dr: 0.30, expires_at: now + 30000 }`.
- In `applyCreatureHit` damage pipeline, just **after** Battle Cry DR (step 7.5): if active, `dmg = max(floor(dmg * (1 - dr)), 1)` and emit a `mitigation_dr` event.

### Buff lifetime cleanup
Reuse the existing buff-expiration sweep that already removes stale `damage_buff` / `stealth_buff` / `evasion_buff` / `absorb_buff` entries. Add the four new keys to that cleanup list.

### Realtime sync (`buffSync`)
Append minimal fields to the existing `buffSync[cid]` payload so the client status bar can show timers:
- `reactive_holy_expires_at`, `block_buff_expires_tick`, `consecrate_ticks_remaining`, `mitigation_dr_expires_at`.

---

## 4. Client implementation

**`src/features/combat/hooks/useCombatActions.ts`**
- Add cases in `handleUseAbility` for the four new types — same pattern as `damage_buff` / `absorb_buff`: call the server (queued ability, since they're combat abilities), add a flavor log line.
- Add queue-flavour entries in `getQueueFlavour` for the four new types.
- Add the four types to `INSTANT_BUFF_TYPES` / `COMBAT_REQUIRED_TYPES` as appropriate:
  - Holy Shield, Shield Wall, Divine Challenge → instant self-buffs (no target needed, can be precast out of combat? — keep them combat-required to match Battle Cry).
  - Consecrate → combat-required, no target.

**`src/features/character/components/StatusBarsStrip.tsx`**
- Render small icons + timers for the four new buffs, mirroring the existing Arcane Surge / Force Shield / Battle Cry pills.

**`src/features/character/components/CharacterPanel.tsx`**
- Show Templar on the class breakdown if present (already iterates `CLASS_ABILITIES`).

---

## 5. Class selection / character creation

**`src/pages/CharacterCreation.tsx`** — verify the class picker reads from `CLASS_LABELS` / `CLASS_DESCRIPTIONS` so Templar appears automatically. If it has a hardcoded list, add `'templar'`.

---

## 6. Validation

- Run vitest (`formula-parity.test.ts` will catch any drift between client and server class constants).
- Manual smoke test: create a Templar, equip sword + shield, engage a creature, use each ability in order.

---

## Files touched (summary)

- `src/shared/formulas/classes.ts` + mirrored `supabase/functions/_shared/formulas/classes.ts`
- `src/lib/game-data.ts`
- `src/features/combat/utils/class-abilities.ts`
- `src/features/combat/hooks/useCombatActions.ts`
- `src/features/character/components/StatusBarsStrip.tsx`
- `src/features/character/components/CharacterPanel.tsx`
- `src/components/admin/GameManual.tsx`
- `src/pages/CharacterCreation.tsx` (only if class list is hardcoded)
- `supabase/functions/combat-tick/index.ts`

No DB migrations. No new tables. No new combat states.
