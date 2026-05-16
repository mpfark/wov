## Goal

Each class has two "primary" stats (per `CLASS_LEVEL_BONUSES`). Today most abilities scale off only one of them, so the second primary contributes nothing to that class's kit beyond passive cross-stat curves (INT→hit, WIS→anti-crit, etc.). We'll split key ability scalars so both primaries matter — starting with the wizard since you called it out, and applying the same rule to every other class.

This is balance/identity work, not a rework. Cost, cooldown, ability list, and visuals don't change.

## Wizard (INT + WIS) — concrete changes

Current scaling (server, `supabase/functions/combat-tick/index.ts` + SQL):

- **Force Shield pool cap:** `max(1, intMod + floor(level/2))` (combat-tick line ~477 and SQL `apply_force_shield_regen` line ~76)
- **Force Shield regen/tick:** `1 + floor(intMod/2)` (SQL line ~77)
- **Ignite pulse direct hit:** `2 + intMod`
- **Ignite burn DoT:** `floor(intMod * 0.7 * 0.67)` per tick, duration `30s + intMod*1s` (cap 45s)
- **Conflagrate (ignite_consume):** `4 + 2*intMod + floor(level/3)` — leave alone (signature INT nuke)
- **Arcane Surge:** flat ×1.15 — leave alone

Proposed split (your suggestion, adopted):

| Effect | Now | Proposed |
|---|---|---|
| Force Shield **pool cap** | `intMod + level/2` | `wisMod + floor(level/2)` |
| Force Shield **regen/tick** | `1 + intMod/2` | `1 + floor(intMod/2)` (unchanged — already INT) |
| Ignite **pulse hit** | `2 + intMod` | `2 + intMod` (unchanged — "strength of the spark" = INT) |
| Ignite **DoT damage/tick** | `floor(intMod*0.7*0.67)` | `floor(wisMod*0.7*0.67)` |
| Ignite **DoT duration** | `30s + intMod*1s` (cap 45s) | `30s + wisMod*1s` (cap 45s) — sustained burn = WIS |

Rationale: the original ask (shield pool=WIS, shield regen=INT; ignite "strength"=INT, dots=WIS) maps cleanly. INT = the "spark / blast / instant force"; WIS = "sustained ward and lingering flame." Both wizard primaries now matter for every spec, and pure-INT glass cannons trade Force Shield size and burn longevity for raw nuke power.

## Other classes — audit & proposed splits

Same rule everywhere: every ability that scales off one of a class's two primaries should be examined; if a sensible secondary lever exists (duration, cap, secondary tick, proc chance, utility magnitude), split it onto the other primary.

### Warrior (STR + DEX)
- **Autoattack:** DEX to-hit, STR damage ✓ already uses both.
- **Rend (DoT):** tick = `(strMod*1.5+2)*0.67`, duration `20s + strMod*1s`. → keep tick=STR, switch **duration** to `20s + dexMod*1s` (precision opens the wound longer).
- **Sunder (debuff):** currently STR-scaled reduction. → keep magnitude=STR; add **duration** scaling to DEX, or vice versa (whichever the current code uses — we'll inspect during impl).
- **Battle Cry:** flat 15% DR. → no change (flat by design).

### Ranger (DEX + WIS)
- **Barrage:** per-arrow base `2 + dexMod + floor(level/4)`, arrowCount = `dexMod>=3 ? 3 : 2`. → keep DEX damage; add **arrow count** threshold to WIS (e.g. `+1 arrow if wisMod>=4`) so WIS-heavy rangers actually fire one extra shaft. Alternatively, give Eagle Eye crit-buff bonus a WIS component (currently `floor(dexMod/2)+1`).
- **Eagle Eye:** currently DEX. → split: bonus = `max(1, floor((dexMod+wisMod)/3)+1)`.

### Rogue (DEX + CHA)
- **Eviscerate:** `4 + 2*dexMod + floor(level/3)`. → keep DEX damage; add **finisher bonus** when target has any active debuff (charisma = trickery/setup) — or simpler: **stealth ambush damage** (currently flat ×2) scales subtly with CHA, e.g. `×(2 + chaMod*0.05)` capped at ×2.5.
- **Disengage:** flat mult. → leave OR scale bonus mult slightly with CHA.

### Healer (WIS + CON)
- **Party regen, holy_shield return:** WIS. → keep WIS for amount; add CON for **duration / max stacks** of holy_shield, or HP threshold of regen tick.

### Bard (CHA + INT)
- **Mock (DoT):** base `chaMod*4 + level*1.5`, tick die `chaMod*2`. → keep CHA for damage; add INT for **duration** and/or **debuff effect** magnitude.

### Templar (WIS + CON)
- Mirrors healer. Holy Shield return = WIS; add CON for **expiration window** or **max return hits**.

We'll lock the exact secondary lever for each non-wizard class once you sign off on the wizard pattern. The principle is constant: **primary stat = magnitude, secondary primary = duration / cap / count / utility scalar**, or vice versa where it reads better thematically.

## Out of scope

- Ability costs, cooldowns, the stance/ability list itself.
- Cross-stat passives (INT→hit, DEX→crit, WIS→anti-crit, STR→damage floor) — those already make non-primary stats matter globally.
- Item budget / stat caps (just shipped).
- Client-side ability tooltips will be updated to reflect the new scalars, but no new UI is added.

## Rollout order

1. **Wizard** (this plan): change Force Shield pool cap to WIS in both `combat-tick/index.ts` and `apply_force_shield_regen` SQL function (new migration); change Ignite DoT damage + duration to WIS in `combat-tick`. Update tooltips/log strings.
2. **Warrior, Ranger, Rogue, Healer, Bard, Templar** — one class per follow-up pass, each with the same review/split exercise above. We confirm the exact secondary lever per class before editing.
3. After all classes are split, update the `mem://game/class-abilities/<class>` notes (or create them) so the "uses both primaries" rule is recorded as canon.

## Open questions before I implement

1. Confirm the wizard mapping above (shield **pool**=WIS, shield **regen**=INT, ignite **pulse**=INT, ignite **DoT damage+duration**=WIS).
2. For Force Shield's OOC behavior: when a wizard with high INT but low WIS activates it, today they get pool=INT. Under the new rule pool=WIS — should we **grandfather existing shields** (clamp current `force_shield_hp` to new cap on next regen tick, which the SQL already does via `least(cap, …)`)? Default plan: yes, no migration of player data needed.
3. For the other six classes, do you want me to draft one combined follow-up plan listing every proposed split, or one plan per class so you can approve them individually?
4. Any class where you'd rather **swap** my mapping (e.g. ranger arrow count = WIS feels off to you and you'd prefer WIS extends a buff duration instead)?
