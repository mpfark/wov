

## Add Wizard Tier 2, 3, and 4 Abilities

### New Abilities

**Tier 2 -- Ignite (Level 10)**
- Mirrors Rogue's Envenom/Eviscerate pattern but with fire
- While active, each spell hit has a 40% chance to apply a stackable burn DoT (max 5 stacks)
- Scales with INT: duration = 20s + INT modifier (capped at 30s)
- Type: `ignite_buff` (new)
- Cooldown: 60s
- Emoji: `🔥🔥`

**Tier 3 -- Conflagrate (Level 15)**
- Consumes all burn (ignite) stacks on the target for a burst of damage
- +50% bonus damage per stack consumed (same multiplier as Rogue's Eviscerate)
- Type: `ignite_consume` (new)
- Cooldown: 45s
- Emoji: `💥`

**Tier 4 -- Force Shield (Level 20)**
- Creates an absorb shield that soaks incoming damage before HP
- Shield amount = INT modifier * 4 + character level
- Duration = 10s + INT modifier (capped at 20s)
- Type: `absorb_buff` (new)
- Cooldown: 90s
- Emoji: `🛡️✨`

### Files to Change

**`src/lib/class-abilities.ts`**
- Add `ignite_buff`, `ignite_consume`, and `absorb_buff` to the `type` union on `ClassAbility`
- Add 3 new entries to `CLASS_ABILITIES.wizard` array (Tiers 2, 3, 4)

**`src/pages/GamePage.tsx`**
- Add new state variables: `igniteBuff`, `igniteStacks` (mirrors `poisonBuff`/`poisonStacks`), and `absorbBuff`
- Add `onAddIgniteStack` callback (mirrors `onAddPoisonStack`)
- Add ignite DoT tick effect (mirrors the poison DoT `useEffect`)
- Add `ignite_buff` handler in `handleUseAbility` (mirrors `poison_buff`)
- Add `ignite_consume` handler (mirrors `execute_attack`, consuming burn stacks)
- Add `absorb_buff` handler: sets `absorbBuff` state with shield HP and expiry
- Pass `igniteBuff`, `onAddIgniteStack`, and `absorbBuff` to `useCombat`

**`src/hooks/useCombat.ts`**
- Accept new props: `igniteBuff`, `onAddIgniteStack`, `absorbBuff`, `onAbsorbDamage`
- In the player attack section: if `igniteBuff` is active, 40% chance to call `onAddIgniteStack(creatureId)` (mirrors poison proc logic)
- In the creature counterattack section: if `absorbBuff` is active, subtract damage from shield first, remainder goes to HP. Call `onAbsorbDamage` to update the shield state. Log shield absorption.

**`src/components/game/CharacterPanel.tsx`**
- Display active ignite buff and force shield in the `ActiveBuffs` section (mirrors existing buff display)

**`src/components/game/NodeView.tsx`**
- Display ignite stack indicator on creatures (mirrors the poison stack `🧪 x N` indicator with a `🔥 x N` display)

### Design Notes
- Ignite mirrors the Rogue's Envenom/Eviscerate combo exactly, giving Wizards their own proc-and-consume playstyle themed around fire
- Force Shield introduces a new defensive mechanic (damage absorption) that fits the Wizard's INT-scaling fantasy
- Conflagrate is the payoff ability -- encourages building stacks before consuming them for burst damage

