

## Rogue Tier 2, 3 & 4 Abilities

### New Abilities

**Envenom (Tier 2, Level 10)** -- `poison_buff` type
- Coats the rogue's weapon in poison for a duration scaling with DEX
- While active, each auto-attack hit has a 40% chance to apply a poison stack to the target
- Each poison stack deals DEX-based damage every 3 seconds
- Stacks are tracked per-creature and accumulate with each successful proc (up to 5 stacks)
- Duration: 20-30 seconds (scaling with DEX modifier)
- Cooldown: 60 seconds

**Eviscerate (Tier 3, Level 15)** -- `execute_attack` type
- A powerful finishing strike that deals bonus damage based on the number of active poison stacks on the target
- Base damage: normal backstab roll, plus bonus damage per poison stack (e.g. +50% per stack)
- Consumes all poison stacks on use
- Requires being in combat with a valid target
- Cooldown: 45 seconds

**Cloak of Shadows (Tier 4, Level 20)** -- `evasion_buff` type
- Wraps the rogue in shadow, granting a 50% chance to dodge incoming attacks for a duration scaling with DEX
- Duration: 10-15 seconds
- Cooldown: 90 seconds
- While active, each dodged attack is logged

---

### Files to Change

**1. `src/lib/class-abilities.ts`**
- Add `'poison_buff' | 'execute_attack' | 'evasion_buff'` to the `ClassAbility.type` union
- Add Envenom (Tier 2), Eviscerate (Tier 3), and Cloak of Shadows (Tier 4) to the rogue ability array

**2. `src/pages/GamePage.tsx`**
- Add `poisonBuff` state: `{ expiresAt: number } | null` -- tracks whether the rogue's weapon is envenomed
- Add `poisonStacks` state: `Record<string, { stacks: number; damagePerTick: number; expiresAt: number }>` -- per-creature poison stack tracker
- Add `evasionBuff` state: `{ dodgeChance: number; expiresAt: number } | null` -- tracks Cloak of Shadows
- Add `poison_buff` handler in `handleUseAbility`: sets `poisonBuff` state, logs the coating
- Add `execute_attack` handler in `handleUseAbility`: reads current poison stacks on the target, calculates bonus damage, deals the hit via `damage_creature` RPC, consumes all stacks
- Add `evasion_buff` handler in `handleUseAbility`: sets `evasionBuff` state, logs activation
- Add a `useEffect` for poison DoT ticks: every 3 seconds, iterate over all creatures with active poison stacks and deal cumulative damage (stacks x damagePerTick), removing expired entries
- Pass `poisonBuff` to `useCombat` so each successful hit can proc a poison stack
- Pass `evasionBuff` to `useCombat` so incoming attacks can be dodged
- Pass `poisonStacks` setter to `useCombat` for the proc logic

**3. `src/hooks/useCombat.ts`**
- Add `poisonBuff`, `poisonStacks`, `onAddPoisonStack`, and `evasionBuff` to `UseCombatParams`
- Add refs for the new buffs and sync them
- In the player attack section (after dealing damage): if `poisonBuff` is active, roll a 40% chance to add a poison stack to the target creature via `onAddPoisonStack` callback
- In the creature counterattack section: if `evasionBuff` is active, roll the dodge chance before applying damage; if dodged, log a miss and skip damage

**4. `src/components/game/CharacterPanel.tsx`**
- Add `poisonBuff` and `evasionBuff` to props and the `ActiveBuffs` display
- Show a poison vial icon when Envenom is active with remaining duration
- Show a shadow cloak icon when Cloak of Shadows is active with remaining duration

---

### Technical Details

**Poison Stack Structure:**

```text
poisonStacks = {
  [creatureId]: {
    stacks: 3,           // number of active stacks (max 5)
    damagePerTick: 2,    // damage per stack per tick
    expiresAt: timestamp  // when stacks expire (refreshed on each new stack)
  }
}
```

Each tick deals `stacks x damagePerTick` damage. Adding a new stack increments the count (capped at 5) and refreshes the expiry timer to 15 seconds from now.

**Poison Proc in Combat Hook:**
After a successful player hit, if `poisonBuff` is active and `Math.random() < 0.4`, call `onAddPoisonStack(creatureId)` which updates the `poisonStacks` state in GamePage.

**Eviscerate Bonus Calculation:**
Base rogue backstab damage + (50% bonus per stack). For example, with 4 stacks: `baseDmg * (1 + 0.5 * 4) = baseDmg * 3`.

**Evasion in Combat:**
Before applying creature counterattack damage, check if `evasionBuff` is active and `Math.random() < 0.5`. If dodged, log "You dodge the attack!" and skip damage entirely.

