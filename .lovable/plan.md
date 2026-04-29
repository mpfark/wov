## Wizard Rework: Ignite Shield + Empowered Arcane Surge

### 1. Ignite — "Shield of Fireballs" (decoupled from autoattack)

**Current**: Ignite is a 5-min buff. Each autoattack hit has a 40% chance to apply a stackable burn DoT. Tied to weapon swings, so a wizard who never autoattacks generates no stacks.

**New**: Ignite is a 5-min buff. While active and the wizard is in combat with at least one alive creature, an orb of fire pulses **every heartbeat (every tick)** at the highest-aggro / first alive target. Each pulse:
- Rolls 40% chance to fire a small fireball at the target.
- On a successful pulse: deals `max(1, 2 + intMod)` direct fire damage AND adds/refreshes one burn stack (max 5), exactly like the existing burn DoT used by Conflagrate.
- Pulses are completely independent of the wizard's autoattack roll — they fire even while the wizard is stealthed, channelling, dead-targeted, or simply standing still.
- If the wizard is dead, has no current target, or is not engaged, the orb is silent.
- A pulse that lands emits an `ignite_pulse` event, e.g. `🔥 A flaming orb leaps from {wizard} and strikes {target}! (3 damage, burn x2)`.

The autoattack-side `mb.ignite_buff` 40% block in `combat-tick` is removed (autoattacks no longer apply burn).

### 2. Arcane Surge — Empowered caster buff

**Current**: 25 CP, ~15-25s buff. Grants +50% damage on autoattacks only via `isDmgBuff` flag. Spells (Fireball T0, Conflagrate, Ignite pulse) ignore it.

**New**: Same CP cost / duration. While active:
- **All wizard damage** is multiplied by **1.5x** — autoattacks, off-hand attacks, T0 Fireball, Conflagrate, the new Ignite pulses, and Force Shield's absorb (no, only outgoing damage; absorb stays as-is).
- **Autoattacks additionally gain `+intMod` flat damage** (post-die roll, post-STR mod). STR remains the autoattack damage modifier; INT bonus is layered on top.
- Updated tooltip: "Channel raw arcane energy. All your damage is increased by 50% and your weapon strikes gain bonus damage from INT."

### 3. Server changes — `supabase/functions/combat-tick/index.ts`

1. **Remove ignite-on-autoattack block** (around lines 860-879).
2. **Add Ignite-pulse phase** inside the per-tick loop, after autoattacks/off-hand and before DoT processing:
   - For each living wizard with `mb.ignite_buff`, in combat (sessionEngaged has any alive target):
     - Pick the first alive non-killed creature in `creatures` (mirrors current autoattack target selection).
     - 40% roll: if pass, compute `intMod`, apply `1.5x` if `mb.damage_buff`, `dmg = max(1, 2 + intMod)`.
     - Subtract from `cHp[target.id]`, push `ignite_pulse` event with target name + damage + new stack count, upsert `active_effects` row of type `ignite` (exactly like the existing autoattack proc — same stack/duration/damage_per_tick formula).
     - If `cHp[target.id] <= 0` call `handleCreatureKill`.
     - `sessionEngaged.add(target.id)` so the orb opens combat too.
3. **Apply Arcane Surge globally**:
   - In autoattack damage block: when `isDmgBuff` is true, also add `+intMod` flat damage before hit-quality scaling — `raw = rollDmg(1, weaponDie) + sMod + intMod`. The existing `dmg = Math.floor(dmg * 1.5)` line stays for the multiplier.
   - In off-hand attack block (~line 909+): same `1.5x` and `+intMod` on the off-hand damage when `isDmgBuff`.
   - In T0 Fireball ability handler (lines 555-592): if attacker's `mb.damage_buff` is active, multiply final `dmg` by 1.5.
   - In Conflagrate (`ignite_consume` handler, ~535-554): if attacker's `mb.damage_buff` is active, multiply final `dmg` by 1.5.

### 4. Catch-up parity — `supabase/functions/combat-catchup/index.ts`

If/where catchup simulates ignite stack accrual on resumed sessions, switch from "applies on autoattack hit" to "pulses per simulated tick at 40% chance." If catchup currently has no special ignite-proc logic (only resolves the persistent `active_effects` rows), no change needed beyond removing any autoattack-tied accrual. (Inspect during implementation; mirror exactly what live combat does.)

### 5. Client changes

**`src/features/combat/utils/class-abilities.ts`**
- Update Ignite description: `"Conjure a shield of fireballs around you. Every heartbeat in combat, an orb has a 40% chance to strike your target — applying a burn stack. 5 minutes. Costs all your CP (minimum 50)."`
- Update Arcane Surge description: `"Channel arcane energy. All your damage is increased by 50% and your weapon strikes gain bonus damage from INT."`

**`src/features/combat/hooks/useCombatActions.ts`**
- Update the Arcane Surge cast log line to mention "all damage" and INT bonus.
- Update the Ignite cast log line to mention "shield of fireballs."

**`src/features/combat/utils/combat-text.ts` / event log handlers**
- Add formatting for the new `ignite_pulse` event type so the event log shows `🔥 {wizard}'s flaming orb sears {target} for X damage (burn x{stacks}).` Color: existing fire / red palette.

**`src/features/combat/hooks/usePartyCombat.ts` / `useBuffState.ts`**
- The existing `onIgniteProc` / `handleAddIgniteStack` path can be reused for `ignite_pulse` events — server emits the same effect upsert and proc event shape, so the client's burn-stack UI updates without further wiring.

### 6. Memory updates

Update `mem://game/class-abilities/wizard` and `mem://game/class-abilities/commitment-buffs` to reflect:
- Ignite: pulses every heartbeat, 40% per pulse, decoupled from autoattacks.
- Arcane Surge: 1.5x to all damage; +INT mod flat to autoattacks (STR remains the modifier).

### Out of scope
- No balance pass on Conflagrate's 0.5x-per-stack multiplier.
- No change to Force Shield, Fireball T0 cost/scaling, or weapon affinity rules.
- No new abilities, no UI layout changes.
