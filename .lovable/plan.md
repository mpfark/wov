# Ranger ability polish

Three independent fixes — no combat-math changes, all UI/log presentation.

## 1. Nature's Snare — debuff icon on target

`useBuffState` already tracks `rootDebuff = { creatureId, damageReduction, expiresAt }` for the local caster (used by both Ranger's Snare and Bard's Dissonance). Nothing renders it on the creature row.

- **`src/pages/GamePage.tsx`** — pass `rootDebuff` into `<NodeView ... />` (next to the existing `sunderDebuff` prop).
- **`src/features/world/components/NodeView.tsx`** —
  - Add `rootDebuff?: { creatureId: string; damageReduction: number; expiresAt: number } | null` to the props type.
  - In the creature row (next to the existing sunder/bleed icons around line 318), render a small Tooltip with `🌿` (Snare) when `rootDebuff?.creatureId === c.id && Date.now() < rootDebuff.expiresAt`. Tooltip text: `Ensnared: damage reduced by {Math.round(reduction * 100)}%`.
  - Use class-agnostic label "Snared" — same icon works for Bard Dissonance (already shares `root_debuff` type and same single-target slot).

## 2. Eagle Eye — show crit boost in attribute panel

Root cause: Eagle Eye is now a **stance** (CP-reserved, persisted via `reserved_buffs.eagle_eye`). The stance branch in `useCombatActions.ts` (lines 184–232) returns BEFORE the legacy `crit_buff` branch (line 345) ever runs, so `setCritBuff(...)` is never called and the panel's `critBuffActive` check (line 839) is always false.

Fix in `src/features/character/components/CharacterPanel.tsx` only — mirror the server formula so the panel reads from `reserved_buffs.eagle_eye` directly:

- Read `reservedBuffs = (character as any).reserved_buffs ?? {}`.
- `eagleEyeActive = !!reservedBuffs.eagle_eye`.
- When active, compute `eagleEyeBonus = Math.max(1, Math.min(5, Math.floor((Math.max(0,dexMod) + Math.max(0,wisMod)) / 2)))` (same formula as `combat-tick` line 462 and `useCombatActions` line 349).
- Replace `effectiveCrit = critBuffActive ? baseCritRange - critBuff!.bonus : baseCritRange` with a combined check: prefer the stance bonus when active, else fall back to the legacy timed `critBuff` for safety.
- Update the Crit Range tooltip (line 946) to say `+{eagleEyeBonus} Eagle Eye` and mark `buffed: true` when the stance is on.
- Also surface Eagle Eye in `ActiveBuffs` strip (line 140 area) so it appears alongside other active effects when the stance is on — show pip with infinity-style "stance" duration (no countdown bar; render as solid like other stances do today, e.g. Holy Shield). If stances already have their own pip row, skip this and only update the Crit Range row — confirm during edit.

Stat-allocation preview math (`statContributions.ts` / `StatPlannerDialog`) is out of scope — base crit range already reflects DEX correctly.

## 3. Barrage — flavor text per arrow, single icon

Currently `supabase/functions/combat-tick/index.ts` lines 650/652 emit per-arrow `ability_hit` / `ability_miss` events with `🏹🏹 Arrow N: <full roll math>` and a separate `🏹🏹 Barrage total: X` summary. The formatter (`combat-text.ts`) only converts `attack_hit/attack_miss/offhand_*/creature_*` to MUD flavor text — `ability_*` falls through unchanged, hence the raw math display. The double bow comes from the hardcoded `🏹🏹` prefix and `WEAPON_EMOJI.bow = '🏹'` not running because event type is `ability_hit`.

Fix in `combat-tick/index.ts` (Barrage block ~lines 634–660):

- Emit each arrow as a structured **`attack_hit` / `attack_miss`** event with:
  - `attacker_name: c.name`, `target_name: t.name`, `attacker_class: c.class`
  - `weapon_tag: 'bow'` (forces 🏹 emoji via `WEAPON_EMOJI`, single icon)
  - `damage: arrowDmg`, `is_crit: isCrit`, `character_id: member.id`
  - Keep `message` as a terse numbers-mode fallback: `Arrow ${i+1}/${arrowCount}: ${roll}+${dexMod}=${totalAtk} vs AC ${t.ac} — ${arrowDmg}` (no `🏹🏹` prefix; the formatter adds the emoji in words/both mode, and numbers-mode keeps the message verbatim).
- Replace the `Barrage total` summary line with a single intro event emitted **before** the loop: `{ type: 'ability_cast', message: `🏹 ${c.name} unleashes a Barrage of ${arrowCount} arrows!`, character_id: member.id }` — short, no math, and won't get reformatted.
- Drop the redundant total-damage event (each arrow now reads naturally as graze/nick/hit/wound/maul/etc.).

No formula changes. Per-arrow crit / stealth / disengage handling stays untouched.

## Out of scope

- Server damage formulas, CP costs, stance reservation %, duration math.
- Bard Dissonance icon — automatically benefits from the shared root_debuff icon in step 1.
- Touching any other class's ability logs.
