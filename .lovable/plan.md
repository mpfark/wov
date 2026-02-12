

## Class-Based Combat Abilities

Currently every class uses STR modifier and deals 1d8 melee damage. This plan introduces unique combat actions per class, each using the appropriate stat and dice, with flavored log messages.

### Combat Abilities by Class

| Class | Action Name | Stat Used | Damage Dice | Flavor |
|-------|-------------|-----------|-------------|--------|
| Warrior | Melee Strike | STR | 1d10 + STR mod | "You swing your blade..." |
| Wizard | Fireball | INT | 1d8 + INT mod | "You hurl a bolt of arcane flame..." |
| Ranger | Arrow Shot | DEX | 1d8 + DEX mod | "You loose an arrow..." |
| Rogue | Backstab | DEX | 1d6 + DEX mod (bonus crit: crits on 19-20) | "You strike from the shadows..." |
| Healer | Smite | WIS | 1d6 + WIS mod | "You channel divine light..." |
| Bard | Cutting Words | CHA | 1d6 + CHA mod | "Your mocking verse cuts deep..." |

### UI Change -- NodeView

Replace the single "Attack" button with a class-themed button label:
- Warrior: "Strike"
- Wizard: "Cast Fireball"
- Ranger: "Shoot"
- Rogue: "Backstab"
- Healer: "Smite"
- Bard: "Mock"

The button passes the same `onAttack(creatureId)` -- the class logic is handled in `handleAttack`.

### Technical Details

**New file: `src/lib/class-abilities.ts`**

Define a `CLASS_COMBAT` config map:

```text
CLASS_COMBAT = {
  warrior: { label: "Strike", stat: "str", diceMin: 1, diceMax: 10, critRange: 20, emoji: "sword", verb: "swing your blade at" },
  wizard:  { label: "Cast Fireball", stat: "int", diceMin: 1, diceMax: 8, critRange: 20, emoji: "fire", verb: "hurl arcane flame at" },
  ranger:  { label: "Shoot", stat: "dex", diceMin: 1, diceMax: 8, critRange: 20, emoji: "bow", verb: "loose an arrow at" },
  rogue:   { label: "Backstab", stat: "dex", diceMin: 1, diceMax: 6, critRange: 19, emoji: "dagger", verb: "strike from the shadows at" },
  healer:  { label: "Smite", stat: "wis", diceMin: 1, diceMax: 6, critRange: 20, emoji: "star", verb: "channel divine light against" },
  bard:    { label: "Mock", stat: "cha", diceMin: 1, diceMax: 6, critRange: 20, emoji: "music", verb: "unleash cutting words upon" },
}
```

**File: `src/pages/GamePage.tsx`** -- Update `handleAttack`:
- Look up `CLASS_COMBAT[character.class]` to get the stat key, dice range, and crit range
- Use `character[ability.stat] + equipmentBonuses[ability.stat]` instead of hardcoded STR
- Use `rollDamage(ability.diceMin, ability.diceMax)` instead of `rollDamage(1, 8)`
- Crit on `atkRoll >= ability.critRange` instead of `atkRoll === 20`
- Use the verb/emoji in the log message

**File: `src/components/game/NodeView.tsx`**:
- Accept `characterClass` prop
- Import `CLASS_COMBAT` from the new file
- Change the Attack button label to `CLASS_COMBAT[characterClass]?.label || "Attack"`

**File: `src/pages/GamePage.tsx`** -- Pass `characterClass={character.class}` to `NodeView`

No database changes needed -- this is purely client-side combat logic.

