## Goal

Make damaging player abilities subject to a to-hit roll (currently they auto-land). Brings them in line with autoattacks and creature attacks, so AC and missing become meaningful for ability play.

## Scope — abilities that gain a to-hit roll

All damaging branches in `supabase/functions/combat-tick/index.ts`:

| Ability                          | Type                | To-hit stat (per class identity) |
| -------------------------------- | ------------------- | -------------------------------- |
| Eviscerate (Rogue)               | `execute_attack`    | DEX                              |
| Conflagrate (Wizard)             | `ignite_consume`    | INT                              |
| Fireball (Wizard)                | `fireball`          | INT                              |
| Power Strike (Warrior)           | `power_strike`      | STR                              |
| Aimed Shot (Ranger)              | `aimed_shot`        | DEX                              |
| Backstab (Rogue)                 | `backstab`          | DEX                              |
| Smite / Judgment (Healer/Templar)| `smite`             | WIS                              |
| Cutting Words (Bard)             | `cutting_words`     | CHA                              |
| Grand Finale (Bard)              | `burst_damage`      | CHA                              |
| Rend (Warrior)                   | `dot_debuff`        | DEX (precision to land bleed)    |

**Unchanged:**
- **Barrage** (`multi_attack`) — already rolls per arrow; keep as is.
- Buffs/heals/debuffs that aren't direct damage (Battle Cry, Snare, Dissonance, Cloak, etc.).
- Crit-edge logic on Grand Finale (separate roll, untouched).

## To-hit formula

Mirror the autoattack pattern already in the Barrage branch:

```
d20 + abilityStatMod + INT hit bonus + weapon affinity hit (if applicable)
   vs creature AC (minus sunder reduction, if any)
```

- Nat 20 always hits; nat 1 always misses (consistent with existing rules).
- Apply **no crit** on these ability rolls — abilities keep deterministic damage. The d20 is purely hit/miss. (Grand Finale still uses its own crit-edge roll.)
- On miss: push an `ability_miss` event with a flavored message and refund nothing (CP/cooldowns already consumed, parity with autoattack miss). Stack consumption for Eviscerate/Conflagrate **still happens on miss** — the strike was committed.
- Procs/buffs (Arcane Surge, stealth, Bond) only multiply on hit, same as autoattacks.

## Implementation steps

1. Add a small helper at the top of the per-ability block in `combat-tick/index.ts`:
   ```
   function rollAbilityHit(statMod, intMod, creatureAC, sunderRed = 0): { hit: boolean; roll: number }
   ```
   Returns `{ hit, roll }` using the rule above.
2. Wrap each of the listed branches with a single hit check before applying damage / DoT. Emit either the existing `ability_hit` event (on hit) or a new `ability_miss` event (on miss). Preserve every existing on-hit side effect (kill resolution, stack consumption, buff consumption).
3. **Client preview** in `useCombatActions.ts` and any tooltip/ability descriptions: add "rolls to hit" wording so players understand the new rule. No client-side prediction changes (these abilities are not predicted today).
4. **Tests**: add a deterministic unit test that confirms each ability branch consults `rollD20` and produces a miss event when the roll fails. The existing combat-resolver test harness pattern is sufficient.

## Open questions

- **Should miss still consume Eviscerate's poison stacks and Conflagrate's burn stacks?** Default in plan: yes (you committed to the strike). Confirm or flip.
- **Should Rend missing prevent the bleed from being applied at all?** Default: yes — miss = no bleed, no refresh of an existing stack.
- **Should boss-rarity creatures get any to-hit nudge** (e.g. abilities ignore Boss AC bonus)? Default: no, treat them like any AC.

If you want different defaults on any of those, tell me and I'll revise before building.