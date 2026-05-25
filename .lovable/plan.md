# Ability Scaling Audit — Eliminate Hardcoded Magnitudes

## Goal

Every active ability should scale on **both** of its owning class's primary attributes — one driving **magnitude** (how strong) and one driving **rate** (duration, ticks, proc chance, or stacks). No more flat `0.30`, `0.15`, `0.50`, `0.70`, `0.40` constants where a class primary could be doing the work.

## Class primaries (reference)

| Class | Primaries |
|---|---|
| Warrior | STR + DEX |
| Wizard  | INT + WIS |
| Ranger  | DEX + WIS |
| Rogue   | DEX + CHA |
| Healer  | WIS + CON |
| Bard    | CHA + INT |
| Templar | WIS + CON |

## Findings — abilities with hardcoded magnitudes today

Scanned `useCombatActions.ts` and the server-side `combat-tick` branches. T0 openers, Heal, Smite, Rend, Sunder, Shadowstep, Eagle Eye, Force Shield, Crescendo, Purifying Light, Divine Aegis, Consecrate, Holy Shield, Shield Wall, Inspire, Grand Finale, Eviscerate already scale on both primaries.

The remaining hardcoded constants are:

| Ability | Class | Current hardcoded value | Primary covered | Primary missing |
|---|---|---|---|---|
| Nature's Snare (root) | Ranger | dmg reduction = **30%** | WIS (duration) | DEX |
| Dissonance (root)     | Bard   | dmg reduction = **30%** | INT (duration) | CHA |
| Battle Cry            | Warrior| DR = **15%** (+5% shield), crit reduction = **15%** | DEX (duration) | STR |
| Cloak of Shadows      | Rogue  | dodge = **50%** | DEX (duration) | CHA |
| Disengage             | Ranger | next-hit bonus = **+50%** | DEX (dodge duration) | WIS |
| Arcane Surge (stance) | Wizard | damage = **+15%** | — (stance) | INT, WIS |
| Conflagrate (consume) | Wizard | **+50% per burn stack** (server) | — | INT, WIS |
| Ignite orb proc       | Wizard | **40% per heartbeat** (server) | INT (dmg), WIS (burn dur) | proc itself flat |
| Envenom proc          | Rogue  | **40% per hit, max 5 stacks** (server) | — | DEX, CHA |
| Barrage per-arrow     | Ranger | **70% damage per arrow** (server) | WIS (arrow count), DEX (dmg) | per-arrow ratio flat |
| Divine Challenge      | Templar| DR = **30%** | CON (duration) | WIS |

## Proposed scaling rules

Use the existing `diminishing` / `diminishingFloat` helpers in `src/shared/formulas/stats.ts` so everything has a soft cap (no runaway scaling, no balance cliff).

```text
Convention: bonus = diminishingFloat(statMod, perPoint, cap)
            floor = sensible base; final = floor + bonus
```

| Ability | New magnitude formula | New rate/duration formula |
|---|---|---|
| Nature's Snare | reduction = 0.25 + diminishingFloat(dexMod, 0.02, 0.15) → 25–40% | duration scales WIS (unchanged) |
| Dissonance     | reduction = 0.25 + diminishingFloat(chaMod, 0.02, 0.15) → 25–40% | duration scales INT (unchanged) |
| Battle Cry     | DR = 0.10 + diminishingFloat(strMod, 0.02, 0.12) (+0.05 shield); critReduction = same formula | duration scales DEX (unchanged) |
| Cloak of Shadows | dodge = 0.40 + diminishingFloat(chaMod, 0.03, 0.20) → 40–60% | duration scales DEX (unchanged) |
| Disengage      | next-hit mult = 1.30 + diminishingFloat(wisMod, 0.05, 0.40) → +30…+70% | dodge duration scales DEX (unchanged) |
| Arcane Surge   | damage bonus = 0.10 + diminishingFloat(intMod, 0.02, 0.12); duration not relevant (stance) | n/a (stance), but minimum-WIS gate replaced by a small WIS rider on the stance's CP-refund tick if needed (alt: leave) |
| Conflagrate    | per-stack bonus = 0.30 + diminishingFloat(intMod, 0.05, 0.40); cap per stack +70% | uses existing burn stack count (scales WIS via ignite) |
| Ignite orb proc| proc chance = 0.25 + diminishingFloat(intMod, 0.04, 0.25) → 25–50% | burn dmg scales INT, burn duration scales WIS (unchanged) |
| Envenom proc   | proc chance = 0.25 + diminishingFloat(dexMod, 0.04, 0.20); max stacks = 3 + diminishing(chaMod, 4) → 3–7 | n/a |
| Barrage        | per-arrow ratio = 0.55 + diminishingFloat(dexMod, 0.04, 0.25) → 55–80% | arrow count scales WIS (unchanged) |
| Divine Challenge | reduction = 0.20 + diminishingFloat(wisMod, 0.03, 0.20) → 20–40% | duration scales CON (unchanged) |

Numbers are chosen so a fresh L1 character lands near today's value (gentle nerf at floor) and high-stat characters earn a meaningful but bounded ceiling. Exact constants are the dial we tune in playtest.

## Where to change code

All scaling lives in two layers — keep them mirrored.

### Client (immediate, magnitude-on-cast abilities)

`src/features/combat/hooks/useCombatActions.ts` — branches for:
`root_debuff`, `battle_cry`, `evasion_buff`, `disengage_buff`, `mitigation_buff`.

Read the relevant stat with the same `p.character.<stat> + p.equipmentBonuses.<stat>` pattern already used in the file, then compute the magnitude via a small helper imported from a new module.

### Server (heartbeat / proc / per-tick abilities)

`supabase/functions/combat-tick/index.ts` — branches that resolve:
`ignite_buff` orb proc, `ignite_consume` (Conflagrate per-stack bonus), `poison_buff` proc and stack cap, `multi_attack` (Barrage per-arrow ratio), and `damage_buff` (Arcane Surge multiplier read).

### New shared helper

Add `src/shared/formulas/abilities.ts` (mirrored to `supabase/functions/_shared/formulas/abilities.ts` per the formula-ownership rule) exposing one small function per ability above, e.g.:

```ts
export function getNatureSnareReduction(dexMod: number): number { ... }
export function getBattleCryDR(strMod: number, hasShield: boolean): { dr: number; crit: number } { ... }
export function getCloakDodge(chaMod: number): number { ... }
export function getDisengageMult(wisMod: number): number { ... }
export function getDivineChallengeReduction(wisMod: number): number { ... }
export function getArcaneSurgeMult(intMod: number): number { ... }
export function getConflagratePerStack(intMod: number): number { ... }
export function getIgniteOrbChance(intMod: number): number { ... }
export function getEnvenomProc(dexMod: number): number { ... }
export function getEnvenomMaxStacks(chaMod: number): number { ... }
export function getBarragePerArrowRatio(dexMod: number): number { ... }
```

Re-export from `src/shared/formulas/index.ts` and `supabase/functions/_shared/formulas/index.ts`.

Also export the constant `ARCANE_SURGE_DAMAGE_MULT` is removed/deprecated in favor of `getArcaneSurgeMult`. Any tooltip text that currently uses `ARCANE_SURGE_DAMAGE_BONUS_PCT` becomes "scales with INT" rather than a fixed `+15%`.

### Tooltip + description updates

`src/features/combat/utils/class-abilities.ts` — update the `tooltip` and `description` strings for the eleven affected abilities to drop fixed percentages and mention the second primary, in the same concise style as the recent tooltip pass. Examples:

- Nature's Snare → "Reduce target's damage. Reduction scales with DEX, duration with WIS."
- Battle Cry → "Reduce incoming damage and soften crits. Magnitude scales with STR, duration with DEX. Stance."
- Cloak of Shadows → "Chance to dodge attacks. Dodge scales with CHA, duration with DEX."
- Disengage → "Dodge briefly; next strike deals bonus damage. Bonus scales with WIS, dodge duration with DEX."
- Arcane Surge → "Increase all your damage. Bonus scales with INT. Stance."
- Conflagrate → "Consume burn stacks for per-stack bonus damage. Per-stack scales with INT."
- Envenom → "Hits may apply stacking poison. Chance scales with DEX, max stacks with CHA. Stance."
- Ignite → "Orbs strike your target. Proc/spark scale with INT, burn duration with WIS. Stance."
- Barrage → "Volley of arrows. Per-arrow damage scales with DEX, arrow count with WIS."
- Divine Challenge → "Take less damage. Reduction scales with WIS, duration with CON."

### Logs

Existing combat-log strings in `useCombatActions.ts` that print the literal `%` value (e.g. Battle Cry, Nature's Snare, Divine Challenge, Cloak) keep printing the *computed* percentage, so they automatically reflect each character's stats.

## Memory updates

After the change lands, update these memory files so future passes don't reintroduce constants:

- `mem://game/class-abilities/warrior` — Battle Cry now dual-primary.
- `mem://game/class-abilities/ranger`  — Nature's Snare + Disengage + Barrage per-arrow now dual-primary.
- `mem://game/class-abilities/rogue`   — Cloak + Envenom now dual-primary.
- `mem://game/class-abilities/bard`    — Dissonance now dual-primary.
- `mem://game/class-abilities/wizard`  — Arcane Surge, Conflagrate, Ignite proc now dual-primary.
- `mem://game/class-abilities/templar` — Divine Challenge now dual-primary.

Add one line to `mem://Core` (or a new leaf `mem://game/ability-scaling-policy`): **"No ability uses hardcoded magnitudes. Magnitude scales on one class primary, rate/duration on the other, via `diminishingFloat` helpers in `shared/formulas/abilities.ts`."**

## Out of scope

- T0 openers and Heal/Smite — already single-stat by design (basic damage/heal) and don't need a second primary.
- Stance CP reservation tiers — unchanged.
- Eagle Eye, Force Shield, Inspire, Rend, Sunder, Shadowstep, Holy Shield, Shield Wall, Consecrate, Purifying Light, Divine Aegis, Crescendo, Grand Finale, Eviscerate, Transfer Health — already dual-primary, no change.
