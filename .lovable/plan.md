# Cross-class ability audit

After the wizard rework (Ignite decoupled from autoattacks; Arcane Surge now globally empowers wizard damage with INT), I audited every other class for the same patterns: abilities that secretly piggyback on autoattacks, buffs that don't apply where they should, and stat formulas that punish certain weapon choices.

## Findings

### 1. Rogue — Envenom (intentional, but the ONE remaining "proc-on-autoattack" buff)

`combat-tick` line ~850: `if (mb.poison_buff && Math.random() < 0.4)` — Envenom still applies poison **only when an autoattack lands**. This is the same shape as the old Ignite.

**Verdict: leave as-is.** Per memory `commitment-buffs`, Envenom and Ignite were designed as a mutually-exclusive pair (5-min, all-CP cost). We deliberately split them: rogues are weapon-strikers, so coupling stack-building to weapon swings reinforces identity. Wizards needed the decoupling because caster wizards (wand/staff) shouldn't have to autoattack to use their resource. No change recommended unless you want symmetry.

### 2. Warrior — `damage_buff` blind spot

Warrior has no `damage_buff` ability, but the autoattack path applies the 1.5x `isDmgBuff` multiplier to **anyone** with the buff. If a future ability or an item proc grants `damage_buff`, warriors get the boost on weapon swings (good) but not on **Rend** (DoT), **Sunder** (debuff), or **Battle Cry** (DR). Rend in particular is a damage source.

**Recommended fix:** Apply `damage_buff` 1.5x to Rend's `damage_per_tick` at apply time (so the bleed inherits the buff at the moment it's cast). Sunder/Battle Cry don't deal damage so are unaffected.

### 3. Ranger — Barrage ignores buffs entirely

`multi_attack` at line ~485 has its own bespoke roll loop that does NOT consult `damage_buff`, `disengage_next_hit`, or `stealth_buff`. So a ranger who casts Disengage and follows up with Barrage gets the +50% on their next autoattack but **not** on the 2-3 arrows of Barrage — surprising.

**Recommended fix:** Apply `damage_buff` (1.5x), `disengage_next_hit` (consume + bonus), and `stealth_buff` (consume + 2x) to Barrage's `arrowDmg` total, so Barrage behaves like an autoattack burst from a buff perspective.

### 4. Ranger — Eagle Eye crit buff doesn't apply to Barrage

Same root cause: Barrage's `if (roll >= critRange)` uses the unmodified class crit range. Eagle Eye (`crit_buff`) is consumed by autoattacks but ignored by Barrage's own roll.

**Recommended fix:** Subtract `mb.crit_buff?.bonus || 0` from `critRange` inside the Barrage loop.

### 5. Bard — Grand Finale ignores `damage_buff`

`burst_damage` at line ~599 computes CHA-scaled damage and writes `cHp` with no buff layer. If a bard ever gets a damage buff (item, future ability), Grand Finale won't benefit.

**Recommended fix:** Same one-liner as Conflagrate: `if (buffs[member.id]?.damage_buff) damage = Math.floor(damage * 1.5);` Cheap consistency.

### 6. Healer — Smite (T0) and Transfer Health unaffected by `damage_buff`

T0 abilities (fireball, power_strike, smite, etc.) at line ~588 already gate on `damage_buff` for **all** classes, so Smite is fine. Transfer Health is a heal so N/A. **No action needed** — flagged for completeness.

### 7. Universal — Off-hand attacks correctly inherit Arcane Surge INT

Verified line ~942: off-hand also adds `intMod` when `damage_buff` is active and applies the 1.5x. Symmetric with main hand. **Good as-is.**

### 8. Universal — Stealth (Shadowstep) and Disengage only consume on main-hand autoattack

Off-hand attacks (line ~937) do NOT consume `stealth_buff` or `disengage_next_hit` and do NOT apply their multipliers. So a dual-wielding rogue's off-hand swing in the same tick neither benefits from nor consumes Shadowstep — the buff is preserved for the next main-hand swing.

**Verdict: probably intentional** (you don't want a single tick to double-consume), but the off-hand also gets no benefit at all, which feels off. Lowest-priority — flagging for awareness, not recommending a change unless you want it.

### 9. Combat-text coloring — clean

Verified `src/features/combat/utils/combat-text.ts`: no remaining class-specific color overrides. The earlier wizard-green fix covered it.

## Recommended changes (prioritized)

| # | Class | Change | Severity |
|---|-------|--------|----------|
| 3 | Ranger | Barrage respects damage_buff / disengage / stealth | High (active gameplay surprise) |
| 4 | Ranger | Barrage respects crit_buff (Eagle Eye) | High (Eagle Eye combo broken) |
| 2 | Warrior | Rend DoT inherits damage_buff at apply | Medium (future-proofing) |
| 5 | Bard | Grand Finale respects damage_buff | Low (no current source for bards) |
| 8 | All | Off-hand consumes/applies stealth+disengage | Skip unless desired |

## Files to modify

- `supabase/functions/combat-tick/index.ts`
  - Barrage block (~485): add buff lookup + apply damage_buff/disengage/stealth, consume them, use crit_buff bonus on critRange
  - Rend block (~609): multiply `dmgPerTick` by 1.5 if `buffs[member.id]?.damage_buff`
  - Grand Finale block (~599): multiply `damage` by 1.5 if `buffs[member.id]?.damage_buff`

No client/UI changes needed — these are server-only damage math additions, and existing combat-log events already render the damage numbers.

## Out of scope

- Envenom rework (intentional design — see Finding 1)
- Off-hand buff consumption (Finding 8 — flag only)
- Tooltip rewrites (formulas don't change visibly enough to require it; can update later)

Approve to apply changes 2–5 (skipping 1 and 8 per design intent), or pick a subset.
