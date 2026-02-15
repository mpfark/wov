

## Class Abilities: Healer Spells and Bard Songs

### Overview
Add two class-specific active abilities that players can trigger manually:
- **Healer -- "Heal"**: A direct healing spell that restores HP to self (or a party member in future), with a cooldown
- **Bard -- "Inspire"**: A song that grants a regen buff (similar to potions), with a cooldown

### Design Decisions

**Cooldown system**: Client-side cooldowns (no database changes needed). Cooldowns reset on page refresh, which is acceptable since these are short utility abilities, not game-breaking powers.

**Healing formula (Healer)**:
- Restores `WIS modifier * 3 + character level` HP (minimum 3)
- 30-second cooldown
- Usable in and out of combat

**Regen buff formula (Bard)**:
- Grants a 2x regen multiplier for 90 seconds (stacks multiplicatively with inn/potion like existing buffs)
- 60-second cooldown
- Usable in and out of combat

### UI
- An "Ability" button appears in the **NodeView** actions area (bottom), only for healer and bard classes
- Shows the ability name, emoji, and remaining cooldown if on cooldown
- Healer sees: "Heal" button
- Bard sees: "Inspire" button

---

### Technical Details

**Files to modify:**

1. **`src/lib/class-abilities.ts`** -- Add a new `CLASS_ABILITIES` definition alongside the existing `CLASS_COMBAT`:
   - Each entry defines: label, emoji, description, cooldownMs, and a type (`heal` or `regen_buff`)
   - Only healer and bard get entries for now

2. **`src/pages/GamePage.tsx`** -- Add ability state and handler:
   - `abilityCooldownEnd` state (timestamp when cooldown expires)
   - `handleUseAbility()` function that:
     - For healer: calculates heal amount, calls `updateCharacter({ hp: newHp })`, logs it
     - For bard: calls `setRegenBuff({ multiplier: 2, expiresAt: Date.now() + 90000 })`, logs it
   - Pass ability info and handler down to NodeView

3. **`src/components/game/NodeView.tsx`** -- Add ability button:
   - New prop for ability data, cooldown state, and onUseAbility callback
   - Render an ability button in the Actions section when the character's class has an ability
   - Show cooldown countdown text when on cooldown
   - Disable button during cooldown or when dead

