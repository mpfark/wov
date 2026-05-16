## Goal

Apply the wizard pattern to every remaining class: **primary stat = magnitude, secondary primary = duration / cap / count / utility scalar** (or thematic reverse). One class per follow-up implementation pass; this plan locks the proposed splits so we don't re-debate per class.

Out of scope: ability costs, cooldowns, ability lists, stance lists, cross-stat passives (INT→hit, DEX→crit, WIS→anti-crit, STR→damage floor), item budgets.

All file refs are current as of audit.

## Per-class audit + proposed split

### Warrior (STR + DEX)

| Ability | Now | Proposed |
|---|---|---|
| Autoattack | DEX to-hit, STR damage | unchanged ✓ already dual |
| Second Wind (self_heal) | `max(3, conMod*3 + level)` — CON only | unchanged (CON is class survival, not a primary) |
| Battle Cry (stance) | DR flat 15%/20% w/ shield; duration `15s+dexMod*1s` (cap 25s); crit_reduction 10% | unchanged — already DEX-scaled duration ✓ |
| **Rend** (dot_debuff, client) | tick=`floor((strMod*1.5+2)*0.67)`, duration `20s+strMod*1s` (cap 30s) | tick = STR (unchanged); **duration = `20s + dexMod*1s` (cap 30s)** — precision keeps the wound open |
| **Sunder Armor** (sunder_debuff, client) | acReduction=`max(2,strMod)`, duration `min(20, 12+strMod)`s | acReduction = STR (unchanged); **duration = `min(20, 12+dexMod)`s** — precise strike, lasting weakness |

Files: `src/features/combat/hooks/useCombatActions.ts` (lines 378–400 Rend, 462–471 Sunder).

### Ranger (DEX + WIS)

| Ability | Now | Proposed |
|---|---|---|
| Aimed Shot (T0) | DEX | unchanged |
| **Eagle Eye** (crit_buff stance) | `bonus = max(1, min(dexMod, 5))` | **`bonus = max(1, min(floor((dexMod+wisMod)/2), 5))`** — focused vision = WIS + DEX |
| **Barrage** (multi_attack, server) | arrowCount = `dexMod≥3 ? 3 : 2`, per-arrow `2+dexMod+floor(lvl/4)` | per-arrow dmg = DEX (unchanged); **arrowCount: base 2, +1 if `dexMod≥3`, +1 more if `wisMod≥4`** (max 4) — WIS-heavy rangers loose one extra arrow |
| Nature's Snare (root_debuff) | reduction 30% flat, duration `min(15s, 8s+wisMod*1s)` | unchanged ✓ already WIS |
| Disengage (disengage_buff) | dodge dur `min(8s, 5s+dexMod*0.5s)`, next-hit +50% for 15s | unchanged (signature mobility) |

Files: `useCombatActions.ts` (crit_buff line 341, root_debuff 358, disengage 416); `combat-tick/index.ts` (Barrage line 602–648 — read `wisMod` from gear-merged stats).

### Rogue (DEX + CHA)

| Ability | Now | Proposed |
|---|---|---|
| Backstab (T0) | DEX | unchanged |
| **Shadowstep** (stealth_buff) | duration `min(25s, 15s+dexMod*1s)`, ambush =flat ×2 | duration = DEX (unchanged); **ambush mult = `min(2.5, 2 + chaMod*0.05)`** — flair amplifies the strike from shadow |
| Envenom (stance, poison_buff) | 40% proc, 5-min duration, max 5 stacks | unchanged (commitment buff) |
| **Eviscerate** (execute_attack, server) | `4 + 2*dexMod + floor(lvl/3)` + 50%/stack | base = DEX (unchanged); **per-stack bonus = `0.50 + chaMod*0.02`** (cap 0.65) — showmanship per stack |
| Cloak of Shadows (evasion_buff) | 50% dodge, dur `min(15s, 10s+dexMod*0.5s)` | unchanged (signature) |

Files: `useCombatActions.ts` (stealth 346, evasion 411); `combat-tick/index.ts` (Eviscerate line 655–665, read chaMod).

### Healer (WIS + CON)

| Ability | Now | Proposed |
|---|---|---|
| Smite (T0) | WIS | unchanged |
| Heal (heal) | `max(3, wisMod*3 + level)` | unchanged (signature WIS spell) |
| **Transfer Health** (hp_transfer) | transfer = `max(3, wisMod*2 + floor(lvl/2))`, costs HP | amount = WIS (unchanged); **caster HP floor: leave 1 HP today → leave `max(1, conMod)` HP** — robust healers can safely sacrifice more without OOM-bottom |
| **Purifying Light** (party_regen, healer branch) | `heal/tick = max(1, wisMod+2)`, dur `min(25s, 15s+wisMod*1s)` | heal/tick = WIS (unchanged); **duration = `min(30s, 15s + conMod*1s)`** — stamina sustains the radiance |
| **Divine Aegis** (ally_absorb) | shieldHp = `wisMod*2 + floor(lvl*0.7)`, no expiry | pool = WIS (unchanged); **add a hard duration `min(60s, 30s + conMod*2s)` instead of `NO_EXPIRY`** — CON gives the ward staying power; today it's infinite which makes CON irrelevant |

Files: `useCombatActions.ts` (heal 296, hp_transfer 278, party_regen 439, ally_absorb 449).

Caveat on Divine Aegis: changing from infinite to timed is the only place this plan adjusts behaviour, not just numbers. Flag for explicit approval.

### Bard (CHA + INT)

| Ability | Now | Proposed |
|---|---|---|
| Cutting Words (T0) | CHA | unchanged |
| Inspire (regen_buff) | hp/cp scale CHA, duration `60–180s + intMod*8s` | unchanged ✓ already dual |
| Dissonance (root_debuff) | flat 30%, dur `min(15s, 8s + wisMod*1s)` ❌ uses WIS (not a bard primary) | **duration = `min(15s, 8s + intMod*1s)`** — bards don't have WIS, INT carries the lingering insult. (Note: bard hits the same `root_debuff` branch as ranger; we'll need to scale by class.) |
| **Crescendo** (party_regen, bard branch) | `heal/tick = max(1, chaMod+2)`, dur `min(25s, 15s+chaMod*1s)` | heal/tick = CHA (unchanged); **duration = `min(30s, 15s + intMod*1s)`** |
| **Grand Finale** (burst_damage, server) | damage scales CHA (Arcane Surge stacks) | magnitude = CHA (unchanged); **add INT crit-edge `+floor(intMod/2)` to the d20 against natural-crit threshold** — knowledge sharpens the killing note. Optional; can also stay magnitude-only. |

Files: `useCombatActions.ts` (root_debuff 358 — class-branch it); `combat-tick/index.ts` (burst_damage line 742–750).

### Templar (WIS + CON)

| Ability | Now | Proposed |
|---|---|---|
| Judgment (T0) | WIS | unchanged |
| **Holy Shield** (stance, reactive_holy) | retaliation = WIS, fixed 30s | retaliation = WIS (unchanged); **duration = `30s + conMod*2s` (cap 60s)** — endurance sustains the ward (this is a stance so duration is "stance kept up"; instead apply duration to the **per-attacker grace window**: today re-trigger every server tick; raise grace to `2s + floor(conMod/2)s` between procs against the same attacker → CON = how often the shield can re-fire) |
| Shield Wall (block_buff stance) | +50% block flat, requires shield | unchanged |
| **Consecrate** (consecrate, server) | heal/tick & burn/tick = `2 + wisMod`, fixed 6s = 3 ticks | per-tick = WIS (unchanged); **number of ticks = `3 + (conMod≥3 ? 1 : 0) + (conMod≥6 ? 1 : 0)`** (cap 5 ticks / 10s) — CON extends sanctified ground |
| **Divine Challenge** (mitigation_buff) | flat 30% DR, 30s | reduction = flat (unchanged); **duration = `min(45s, 30s + conMod*1s)`** |

Files: `useCombatActions.ts` (reactive_holy 474, consecrate 483, mitigation_buff 489); `combat-tick/index.ts` (Holy Shield retaliation 913–921, Consecrate loop 960–1000).

## Rollout order

One class per follow-up pass. Suggested order:

1. **Warrior** — pure client-only, two scalar swaps. Lowest risk, fastest test.
2. **Ranger** — touches client (Eagle Eye) + server (Barrage arrow count).
3. **Rogue** — touches client (Shadowstep) + server (Eviscerate per-stack bonus).
4. **Bard** — requires branching `root_debuff` by class so Dissonance reads INT while Nature's Snare keeps WIS.
5. **Healer** — Divine Aegis behaviour change (infinite → timed) needs explicit sign-off before edit.
6. **Templar** — most touch points (Holy Shield grace, Consecrate ticks, Divine Challenge dur).

Each pass also updates the matching `mem://game/class-abilities/<class>` note (creating if absent) so the dual-primary rule is recorded as canon, plus the GameManual tooltips and `class-abilities.ts` description strings.

## Open questions before I implement any of these

1. **Healer Divine Aegis**: today it lasts until fully absorbed (infinite timer). My proposal caps it at `min(60s, 30s + conMod*2s)`. Acceptable, or keep infinite and put CON elsewhere (e.g. shield pool gets a CON kicker `+conMod` on top of WIS)?
2. **Bard Grand Finale INT crit-edge**: nice-to-have or skip? Skipping leaves Grand Finale CHA-only.
3. **Bard Dissonance**: confirm we should branch the shared `root_debuff` handler by class so bard reads INT and ranger still reads WIS.
4. **Templar Holy Shield**: prefer the "per-attacker grace window scales with CON" model, or a simpler "+conMod% retaliation damage" (CON kicker on the magnitude)? The grace-window version preserves identity better.
5. **Ranger Barrage**: confirm `wisMod≥4 → +1 arrow` is the right gate, or you'd rather WIS extend Eagle Eye duration (currently fixed 30s) instead.
6. Any class where you want to swap my mapping?

Once you answer, I'll start the warrior pass.
