
# Basic Combat Rework — Weapon-Based Autoattacks (v2)

> **What changed in v2 vs v1:** (1) Two-handed weapons now use a **larger die only** — the 1.25× multiplier is removed from autoattacks (Option B). (2) Added an explicit "verify offhand affinity" step before implementation. (3) Strengthened transitional-legacy markers around ability handlers that still use class dice.

## 1. Audit of the current system

### Where main-hand autoattack damage / hit / crit / text are generated
- **Server (authoritative):** `supabase/functions/combat-tick/index.ts`, lines ~693–841 (`Member auto-attacks` block).
  - Reads `CLASS_ATK[c.class]` (built from `CLASS_COMBAT_PROFILES` at line 108–111) → picks `stat`, dice `min/max`, `crit` range, `emoji`, `verb`.
  - Damage = `rollDmg(atk.min, atk.max) + sMod(class stat)`, then hit-quality, crit, affinity, **2H ×1.25**, buffs, caps.
  - Hit text formatted inline using `atk.emoji`, `atk.verb`, `atk.stat.toUpperCase()`.
- **Shared formula module:** `src/shared/formulas/classes.ts` (`CLASS_COMBAT_PROFILES`, `CLASS_BASE_AC`, `CLASS_BASE_HP`, weapon affinity, offhand/2H constants) — mirrored to `supabase/functions/_shared/formulas/classes.ts`.
- **Shared resolver helper:** `src/shared/formulas/combat.ts → resolveAttackRoll()` uses `CLASS_COMBAT_PROFILES` (currently used only by tests/parity, not by the live tick path).

### Where offhand attacks are calculated
- `combat-tick/index.ts` lines ~843–910 (`Off-hand bonus attack` block).
  - Reuses the **same** `CLASS_ATK[c.class]` profile (so a wizard offhand still rolls the wizard "spell" die).
  - Multiplies final damage by `OFFHAND_DAMAGE_MULT = 0.30`.
  - Triggered only when `isOffhandWeapon(offHandTag)` returns true (shields excluded).
  - **Affinity:** the offhand block does NOT call `getWeaponAffinityBonus` today — confirmed by reading lines 843–910. So today, offhand attacks receive **no class+weapon affinity bonus**. We will preserve that.

### Where two-handed damage is applied
- `combat-tick/index.ts` line 738: `if (isTwoHanded[m.id]) dmg = Math.floor(dmg * TWO_HANDED_DAMAGE_MULT)` (1.25×).
- Only applied in the **main-hand block**. Not applied to offhand (impossible — 2H precludes offhand). Not applied to abilities.

### Which abilities reuse class dice / `CLASS_COMBAT_PROFILES`
Inside `combat-tick/index.ts` ability handlers:
- `multi_attack` (Barrage) → `CLASS_ATK.ranger.min/max` + DEX.
- `execute_attack` (Eviscerate) → `CLASS_ATK.rogue.min/max` + DEX.
- `ignite_consume` (Conflagrate) → `CLASS_ATK.wizard.min/max` + INT.
- `burst_damage` (Grand Finale), `dot_debuff` (Rend) → use stat formulas, **not** class dice.
- `Focus Strike` adds flat bonus damage to the **next autoattack only** (not abilities).
- 2H multiplier and offhand multiplier do **not** affect abilities today.

### Combat text paths depending on class verbs
- `combat-tick/index.ts` builds `attack_hit` / `attack_miss` / `offhand_hit` / `offhand_miss` event messages directly using `atk.emoji` + `atk.verb`.
- `src/features/combat/utils/combat-text.ts` already has a `WEAPON_VERBS` table and `resolvePlayerAttackVerb(class, weaponTag)` — but the MUD-style "tier+flavor" rewrite already ignores class verbs when `displayMode !== 'numbers'`; only the emoji is class-derived. Class "spell" override branch (`wizard/healer/bard`) still exists in `CLASS_ATTACK_VERBS` and will be removed.

### Client-side prediction / display dependencies
- `src/features/combat/utils/combat-predictor.ts` — uses `CLASS_COMBAT_PROFILES` for average damage prediction.
- `src/features/character/components/CharacterPanel.tsx` (lines 6, 923, 1003) — shows class attack info in the character sheet.
- `src/features/character/components/StatPlannerDialog.tsx` (line 87) — uses `CLASS_COMBAT[class]` for stat planner previews.
- `src/features/world/components/NodeView.tsx` (line 325) — uses `CLASS_COMBAT[class].label` as the autoattack button label ("Strike", "Cast Fireball", "Smite"…).
- `src/components/admin/GameManual.tsx` and `RaceClassManager.tsx` — display the class profile table (admin/docs only).

### Items / weapon data available
DB-confirmed `weapon_tag` values: `sword`, `axe`, `mace`, `dagger`, `bow`, `staff`, `wand`, `shield`. `hands` is 1 or 2 (some legacy items have null hands; treat as 1).

---

## 2. Proposed new formula

### Universal weapon-based autoattack (all classes)

```
mainHandDamage =
    rollDamage(weaponDie[weapon_tag, hands]) + getStatModifier(STR)
  → hitQualityMultiplier
  → critMultiplier (×2 on crit, with WIS anti-crit)
  → weaponAffinityMultiplier (kept; class+weapon synergy stays as build incentive)
  → buffs (Focus Strike flat add, Stealth ×2, Damage Buff ×1.5, Disengage)
  → clamp / quality caps
```

**No separate 2H multiplier for autoattacks.** The two-handed benefit is fully expressed in the larger weapon die. Cleaner, no double-dip. (Option B from feedback.)

**Hit roll** keeps the existing system: `d20 + STR mod + INT hit bonus + affinity hit bonus`. Crit threshold keeps the existing system: `20 − dexCritBonus − critBuff − level28Milestone`.

### Weapon die table (new constant `WEAPON_DAMAGE_DIE`)

| weapon_tag | hands=1 die | hands=2 die |
|---|---|---|
| dagger  | 1d4 | — |
| wand    | 1d4 | — |
| sword   | 1d6 | 1d10 |
| axe     | 1d6 | 1d10 |
| mace    | 1d6 | 1d10 |
| staff   | 1d6 | 1d8 |
| bow     | — | 1d8 |
| unarmed | 1d3 | — |

Two-handed damage benefit is **purely from the larger die** — no 1.25× multiplier. If post-launch testing shows 2H feels weak, **tune the table** (e.g. bump 2H sword to 1d12) rather than reintroducing a multiplier.

### Offhand
```
offhandDamage =
    rollDamage(weaponDie[offhand_tag, 1])  // offhand is always 1H
  + getStatModifier(STR)
  → hitQualityMultiplier → critMultiplier
  → × 0.30  (OFFHAND_DAMAGE_MULT, unchanged)
  → caps
```
- Uses the **offhand weapon's own die**, STR scaling.
- **No 2H multiplier** (impossible with offhand anyway — and irrelevant now that we've removed the multiplier entirely).
- **No affinity** — preserves today's behavior (verified: server tick offhand block lines 843–910 does not call `getWeaponAffinityBonus`).

### Helper API to add to `src/shared/formulas/combat.ts` (mirrored to Deno copy)

```ts
export const WEAPON_DAMAGE_DIE: Record<string, { oneHand?: number; twoHand?: number }> = { … };
export const UNARMED_DIE = 3;

export function getWeaponDie(weaponTag: string | null | undefined, hands: 1 | 2): number;
export function rollWeaponAttackDamage(weaponTag, hands, str): number; // 1d{die} + STR mod
```

`resolveAttackRoll` in `combat.ts` is updated to take `weaponTag` + `hands` instead of class dice. Per-class crit (rogue 19) is migrated to a small `CLASS_CRIT_RANGE` table so we don't lose rogue's slight crit edge.

---

## 3. Files to change

### Shared formulas (must mirror client ↔ Deno)
- `src/shared/formulas/combat.ts` + `supabase/functions/_shared/formulas/combat.ts`
  - Add `WEAPON_DAMAGE_DIE`, `UNARMED_DIE`, `getWeaponDie`, `rollWeaponAttackDamage`.
  - Update `resolveAttackRoll` to use weapon die + STR (`AttackContext` gains `weaponTag`/`hands`; `classKey` retained only for crit threshold + affinity).
- `src/shared/formulas/classes.ts` + Deno mirror
  - Mark `CLASS_COMBAT_PROFILES` as **legacy** (kept for now, no longer used by autoattacks). Add `CLASS_CRIT_RANGE` (`rogue: 19`, others `20`).
  - `TWO_HANDED_DAMAGE_MULT` is no longer applied in autoattacks. Either delete it or leave with a clear `@deprecated — autoattacks no longer apply this; 2H benefit lives in weapon die table` comment so nothing silently regresses.

### Server tick (authoritative)
- `supabase/functions/combat-tick/index.ts`
  - **Main-hand block (~693–841):** replace `CLASS_ATK[c.class]` lookup with weapon-die path. Stat becomes `STR`. **Remove** the `if (isTwoHanded[m.id]) dmg *= TWO_HANDED_DAMAGE_MULT` line (line 738) — 2H benefit is in the die now.
  - **Off-hand block (~843–910):** replace `CLASS_ATK[c.class]` lookup with offhand weapon's die + STR. Affinity stays absent (preserving today's behavior).
  - **Ability handlers (`multi_attack`, `execute_attack`, `ignite_consume`):** leave logic untouched. Add a prominent block-comment **above each handler**:
    ```ts
    // ⚠️ TRANSITIONAL LEGACY (basic-combat-rework v2):
    // Basic autoattacks are now WEAPON-BASED (weapon die + STR).
    // This ability handler still uses CLASS_ATK (legacy class dice).
    // To be migrated in the T0 ability rewrite. Do NOT copy this pattern
    // for new abilities — use stat-scaling formulas instead.
    ```
  - Update `attack_hit` / `attack_miss` / `offhand_hit` / `offhand_miss` event payloads: ensure `weapon_tag` is present (already mostly there); the message string now reads e.g. `"Rolled X + Y STR + … = Z vs AC … — N damage."` (no class verb baked in).

### Client text & prediction
- `src/features/combat/utils/combat-text.ts`
  - Remove the `CLASS_ATTACK_VERBS` "spell-class override" branch in `resolvePlayerAttackVerb` so wizards/healers/bards no longer say "hurl fireball" / "smite" on basic autoattacks. Keep `WEAPON_VERBS` as the primary source. Class verbs only used as a last fallback.
  - `getEventEmoji`: prefer a `WEAPON_EMOJI` table (`sword:⚔️, dagger:🗡️, bow:🏹, staff:🪄, wand:✨, mace:🔨, axe:🪓, shield/none:✊`) over `CLASS_COMBAT[class].emoji`.
- `src/features/combat/utils/combat-predictor.ts`
  - Switch from `CLASS_COMBAT_PROFILES[class]` to `getWeaponDie(weaponTag, hands)` + STR. Add `weaponTag` and `hands` to `PredictionContext`. Remove any 2H multiplier reference (none in predictor today, but verify).

### UI (read-only display, no balance impact)
- `src/features/character/components/CharacterPanel.tsx` — show "Weapon: 1d{die} + STR" instead of class dice. Drop the "OFFHAND_DAMAGE_MULT" line if it now reads stale; keep the existing offhand info row (still 30%). Keep "Crit range" line using `CLASS_CRIT_RANGE`.
- `src/features/character/components/StatPlannerDialog.tsx` — same.
- `src/features/world/components/NodeView.tsx` — autoattack button label becomes generic `"Attack"` (or weapon-derived: `"Slash" / "Stab" / "Shoot"`). Removes "Cast Fireball" / "Smite" labels.
- `src/components/admin/GameManual.tsx` / `RaceClassManager.tsx` — update copy to describe the new universal autoattack model. Add a short callout that two-handed damage now lives in the die table, not a multiplier.

### Not changed
Creature attacks, XP, loot, durability, marketplace, movement, party, regen, boss crit flavor, renown, Focus Strike behavior, ability balance, offhand 30% multiplier.

---

## 4. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| 2H weapons feel weaker than today (lost the 1.25×, gained only larger die) | **Medium** | Today: warrior 2H sword = `1d10 + STR × 1.25` ≈ `(5.5+STR)×1.25` ≈ `6.9 + 1.25·STR`. New: `1d10 + STR` ≈ `5.5 + STR`. So 2H baseline drops ~15–20% for warriors. Other classes had `1d8/1d6` 2H damage and gain from the 1d10 die. **Action:** if warrior 2H feels weak in playtest, bump 2H sword/axe/mace to **1d12**. Document this as the dial. |
| Damage shift for non-warrior classes (was class die / class stat → now weapon die / STR) | **Medium** | Casters typically equip wands/staves (1d4–1d6) → autoattack output drops, intended. Class identity returns via T0 ability rewrite (follow-up). Patch notes will call this out. |
| Caster classes have low STR → weak autoattacks | **Medium / by design** | Intended. Players who want strong autoattacks invest in STR and equip a melee weapon. |
| Ability handlers still reference `CLASS_ATK[ranger/rogue/wizard]` | **Low** | Left intentional with **loud transitional comments** + memory note. `CLASS_COMBAT_PROFILES` remains exported. |
| Combat predictor mismatch with server | **Low** | Mirror the formula in `combat-predictor.ts`; existing parity test pattern catches drift. |
| Existing `attack_hit` events in old logs use class verb in `message` | **Low** | We keep event `message` as a sane "numbers mode" string; flavor mode regenerates client-side. |

---

## 5. Implementation order

1. **Pre-step — verify offhand affinity in code.** Re-read `combat-tick/index.ts` lines 843–910 once more before edits to confirm `getWeaponAffinityBonus` is not called there. (Audit currently shows it isn't; double-check at edit time.)
2. **Shared formulas** — Add `WEAPON_DAMAGE_DIE`, `getWeaponDie`, `rollWeaponAttackDamage`, `CLASS_CRIT_RANGE` to `src/shared/formulas/combat.ts` + `classes.ts`. Deprecate `TWO_HANDED_DAMAGE_MULT`. Mirror to Deno copies. Add unit tests covering: 1H sword/dagger/wand, 2H sword/staff/bow, unarmed, rogue crit range = 19.
3. **Server tick** — Update main-hand and offhand blocks to use weapon-die path. **Delete** the 2H multiplier line. Add the loud transitional comments above the three legacy ability handlers. Deploy edge function.
4. **Client predictor** — Update `combat-predictor.ts` to weapon-die path + extend `PredictionContext` with `weaponTag` and `hands`. Update call sites.
5. **Client text** — Remove "spell class" override in `combat-text.ts`; switch emoji to weapon-based (`WEAPON_EMOJI`).
6. **UI labels** — Update `CharacterPanel`, `StatPlannerDialog`, `NodeView` attack-button label, admin `GameManual` / `RaceClassManager` copy.
7. **Smoke test** — Run vitest, tick a creature solo & in a party, confirm logs read sensibly for each class with each weapon type. Pay specific attention to warrior with 2H to gauge whether the die table needs a bump.
8. **Memory update** — Update `mem://game/combat-system/weapon-mechanics` to reflect: autoattacks are weapon-based STR-scaling; 2H benefit lives in weapon die only.

Each step is independently shippable and reversible.

---

## 6. Follow-up: T0 ability rewrite (separate task)

Document but do **not** implement now:
- Replace per-class autoattack identity with class-specific T0 abilities:
  - Wizard T0: **Fireball** (INT scaling).
  - Healer T0: **Smite** (WIS scaling).
  - Rogue T0: **Backstab** (DEX scaling, opener).
  - Ranger T0: **Aimed Shot** (DEX scaling).
  - Bard T0: **Cutting Words** (CHA scaling).
  - Warrior T0: keep **Focus Strike / Power Strike**.
- Migrate the three legacy ability handlers (`multi_attack`, `execute_attack`, `ignite_consume`) off `CLASS_ATK[…]` onto stat-scaling formulas — guided by the transitional comments dropped in step 3.
- Once T0s ship, fully delete `CLASS_COMBAT_PROFILES.{dice,stat,verb}` fields and the deprecated `TWO_HANDED_DAMAGE_MULT` constant.
