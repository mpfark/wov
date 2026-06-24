## Goal

Make physical weapon abilities actually care about the equipped weapon. Right now Power Strike, Aimed Shot, Backstab, Eviscerate, Rend, and Barrage all use fixed math — a soulforged sword and a rusty one hit for the same number. After this change, the weapon's die, tier, and rarity feed directly into each strike.

## Formula

All affected abilities switch to:

```text
damage = WeaponDie + statMod + abilityBonus
```

- **WeaponDie** = roll `1dN` where N comes from the same `getWeaponDieForItem(...)` already used by autoattacks (so weapon level/rarity/tier scaling carries over for free).
- **statMod** = the ability's primary stat modifier (STR / DEX), matching today's hit roll.
- **abilityBonus** = the part that makes it feel like an ability and not a basic swing.
- **Unarmed fallback:** if no main-hand weapon is equipped, use `1d4` and a `weapon_tag` of `unarmed`. Hit roll and ability bonus unchanged.
- Existing multipliers (bond, Arcane Surge, stealth, etc.) keep applying after the roll, in the same order as today.
- Existing **to-hit roll on miss** still skips damage entirely (no weapon roll on miss).

### Per-ability `abilityBonus`

Tuned to land in the same neighborhood as today's `5 + 2*statMod + level/3` once a tier-appropriate weapon is equipped, so this is a flavor/scaling change rather than a flat buff.

| Ability       | Stat | Weapon          | abilityBonus                          | Notes                                          |
| ------------- | ---- | --------------- | ------------------------------------- | ---------------------------------------------- |
| Power Strike  | STR  | main hand       | `3 + statMod + floor(level/3)`        | Two-handed weapons benefit naturally (bigger die). |
| Aimed Shot    | DEX  | main hand (bow) | `3 + statMod + floor(level/3)`        | If main-hand isn't a bow tag → unarmed 1d4 fallback. |
| Backstab      | DEX  | main hand       | `3 + statMod + floor(level/3)`        | Stealth multiplier still wraps the total.       |
| Eviscerate    | DEX  | main hand       | `2 + statMod + floor(level/3)` + per-stack CHA bonus (unchanged) | Stack consumption on miss unchanged. |
| Rend (bleed)  | DEX  | main hand       | initial hit: `2 + statMod`; DoT ticks: `floor((WeaponDie_avg + statMod)/3) per tick × duration` | Bleed pulled from weapon damage so big swords bleed harder. |
| Barrage       | DEX  | main hand (bow) | per arrow: roll `1dWeaponDie + floor(statMod/2)`, then apply existing crit / stealth / count rules | Drops the current `perArrowBase` calc. |

## Files to touch

- `supabase/functions/combat-tick/index.ts`
  - Add a small `getMemberWeaponDie(member)` helper near the equipment block that returns `{ die, tag }` (1d4 / `unarmed` fallback).
  - Rewrite the damage line in each of the six handlers above; leave the to-hit roll, miss flavor, kill resolution, and buff/proc plumbing alone.
  - `multi_attack` (Barrage) — replace `perArrowBase` with a per-arrow weapon roll; keep arrow count, crit range, stealth/disengage consumption as-is.
  - `execute_attack` (Eviscerate) — replace `baseDmg` line; keep stack math.
  - `dot_debuff` (Rend) — recompute initial damage and per-tick magnitude from weapon die; leave duration formula alone.
  - T0 block — branch `power_strike` / `aimed_shot` / `backstab` out of the shared `5 + 2*statMod + level/3` line into the new formula. `fireball`, `smite`, `cutting_words` stay on the old stat-only formula (spells/words, no weapon).
- `src/features/character/abilities/*` tooltip strings — update wording to "Rolls weapon damage + STR/DEX + bonus" so players see why their new sword matters.
- `supabase/functions/combat-tick/abilities.test.ts` (or whichever the existing ability test file is) — add deterministic cases for: (a) bigger die → bigger damage, (b) unarmed fallback = 1d4, (c) miss → no weapon roll, (d) Barrage rolls die per arrow.

## Memory update

Append a new entry under `mem://game/combat-system/` describing "Weapon abilities roll equipped weapon die + stat + ability bonus; unarmed = 1d4" and link it from the index, so this rule sticks across future ability work.

## Non-goals

- No change to spells (Fireball, Smite, Cutting Words, Grand Finale, Conflagrate) — they remain stat-only.
- No change to buffs, heals, debuffs without damage.
- No change to to-hit math, crit rules, or proc system.
- No balance pass on weapon dice tables themselves.
