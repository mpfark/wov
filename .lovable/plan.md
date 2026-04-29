# T0 Ability Refactor — Phase 1

Replace the universal Focus Strike with six class-specific Tier 0 abilities. Strict scope: in-combat only, single-target damage, queued via existing `pending_actions` pipeline, resolved on the next combat tick. Zero new combat systems.

## Phase 1 Scope (explicit)

In: six new T0 abilities, server handlers, full Focus Strike removal.
Out: openers, first-cast-free, cast bars, stuns, taunts, AoE, Backstab opener bonus, new creature columns, new session state. All of those are explicitly Phase 2.

## The Six T0s

| Class   | Ability        | Stat | `type` (string)   |
|---------|----------------|------|-------------------|
| Wizard  | Fireball       | INT  | `fireball`        |
| Warrior | Power Strike   | STR  | `power_strike`    |
| Ranger  | Aimed Shot     | DEX  | `aimed_shot`      |
| Rogue   | Backstab       | DEX  | `backstab`        |
| Healer  | Smite          | WIS  | `smite`           |
| Bard    | Cutting Words  | CHA  | `cutting_words`   |

All identical mechanically:
- `cpCost: 10` (matches old Focus Strike)
- `tier: 0`, `levelRequired: 1`
- Single target, in-combat only
- Guaranteed hit, no crit roll (Option A — simplest, parity across classes)
- Damage: `max(1, 5 + 2 * statMod + floor(level / 3))`
- Resolved server-side on next combat tick via existing `pending_actions` queue

## Damage Math (sanity check)

```text
At level 1, statMod = +2 (stat = 14): damage = 5 + 4 + 0 = 9
At level 10, statMod = +4 (stat = 18): damage = 5 + 8 + 3 = 16
At level 20, statMod = +6 (stat = 22): damage = 5 + 12 + 6 = 23
At level 40, statMod = +8 (stat = 26): damage = 5 + 16 + 13 = 34
```

Comparable to a low-mid weapon autoattack. Acceptable for Phase 1; tuning happens after playtest.

## Files to Change

### 1. `src/features/combat/utils/class-abilities.ts`
- Delete `UNIVERSAL_ABILITIES` export entirely (and the Focus Strike entry inside it).
- Extend the `ClassAbility.type` union: remove `'focus_strike'`, add `'fireball' | 'power_strike' | 'aimed_shot' | 'backstab' | 'smite' | 'cutting_words'`.
- Add one T0 entry to each class array in `CLASS_ABILITIES` with the fields above. Description copy is short and class-flavored, no mechanics tied to weapons.

### 2. `supabase/functions/combat-tick/index.ts`
- In the pending-action loop (around line 478, where `multi_attack`/`execute_attack`/`ignite_consume` are handled), add a unified branch for the six new types. Implementation pattern mirrors `execute_attack` (guaranteed hit, no d20, no stacks):

```ts
// inside the same `for (const pa of pendingActions)` loop
const T0_STAT: Record<string, 'str' | 'dex' | 'int' | 'wis' | 'cha'> = {
  fireball: 'int', power_strike: 'str', aimed_shot: 'dex',
  backstab: 'dex', smite: 'wis', cutting_words: 'cha',
};
const T0_LABEL: Record<string, { emoji: string; verb: string }> = {
  fireball:      { emoji: '🔥',  verb: 'hurls a fireball at' },
  power_strike:  { emoji: '⚔️',  verb: 'delivers a crushing blow to' },
  aimed_shot:    { emoji: '🎯',  verb: 'looses an aimed shot at' },
  backstab:      { emoji: '🗡️', verb: 'backstabs' },
  smite:         { emoji: '⭐',  verb: 'smites' },
  cutting_words: { emoji: '🎵',  verb: 'mocks' },
};

if (T0_STAT[pa.ability_type]) {
  const stat = T0_STAT[pa.ability_type];
  const eff = (c[stat] || 10) + (eb[stat] || 0);
  const mod = sm(eff);
  const dmg = Math.max(1, 5 + 2 * mod + Math.floor((c.level || 1) / 3));
  cHp[target.id] = Math.max(cHp[target.id] - dmg, 0);
  const { emoji, verb } = T0_LABEL[pa.ability_type];
  events.push({
    type: 'ability_hit',
    message: `${emoji} ${c.name} ${verb} ${target.name} for ${dmg} damage.`,
    character_id: member.id,
  });
  if (cHp[target.id] <= 0 && !cKilled.has(target.id)) {
    handleCreatureKill(target, c.name, (c.cha || 10) + (eb.cha || 0));
  }
  continue;
}
```

CP deduction, target validation, and kill handling all reuse the existing surrounding code (lines 460–476, `handleCreatureKill`).

### 3. Focus Strike removal — full sweep

All sites identified by grep:

- `src/features/combat/utils/class-abilities.ts` — `UNIVERSAL_ABILITIES` + type union member
- `src/features/combat/hooks/useCombatActions.ts` — line 27 (set entry), line 380 (`focus_strike` handler branch)
- `src/features/combat/hooks/useBuffState.ts` — `FocusStrikeBuff` state, setter, dependency arrays, `buff_sync` mapper, `buff:clear` handler
- `src/features/combat/hooks/useGameLoop.ts` — `FocusStrikeBuff` interface
- `src/features/combat/hooks/usePartyCombat.ts` — `focus_strike?` field on the `mb` shape (line 55)
- `src/features/combat/index.ts` — `FocusStrikeBuff` re-export
- `src/hooks/useGameEvents.ts` — `'focusStrike'` from `buff:clear` payload union
- `src/shared/formulas/combat.ts` — `focusStrikeDmg` option in damage helper (lines 278, 287); also remove from any consumer
- `supabase/functions/combat-tick/index.ts` — `hasFocusStrike` and the bonus-damage block (lines 731, 771–775); the autoattack damage step no longer reads `mb.focus_strike`
- `src/pages/GamePage.tsx` — five references in the buff-passthrough plumbing (lines 523, 920, 931, 947, 948, 1121)
- `src/features/character/components/StatusBarsStrip.tsx` — prop, ActiveBuffs entry, render block (lines 31, 36, 129–130, 161, 248)
- `src/features/character/components/CharacterPanel.tsx` — prop (line 43)
- `src/features/party/components/PartyPanel.tsx` — buff-list entry (line 45)
- `src/features/world/components/MapPanel.tsx` — `focusStrike?` prop (line 33)

This is the bulk of the work — ~15 files, all mechanical deletions with no logic to design. Run `rg "focus_strike|focusStrike|FocusStrike|FOCUS_STRIKE"` after the pass to confirm zero hits.

### 4. Mirrored formula module

The Deno mirror `supabase/functions/_shared/formulas/combat.ts` will need `focusStrikeDmg` removed too if it is byte-mirrored from the client copy. Confirm and update.

### 5. Client UI

No changes. The ability tray already iterates `[...UNIVERSAL_ABILITIES, ...CLASS_ABILITIES[class]]` (or equivalent). After removing `UNIVERSAL_ABILITIES`, audit that consumer and switch it to just `CLASS_ABILITIES[class]`. The new T0s render automatically.

## Risks

- **Focus Strike removal is wide-reaching** (~15 files). Risk is missed references causing TS errors. Mitigation: final `rg` sweep before declaring done.
- **Damage numbers may feel underwhelming for casters at low CP investment**. Acceptable per scope; Phase 2 tuning.
- **`buff_sync` schema change** (`focus_strike` field disappears from broadcast payload). Older clients still in a session won't crash — they just ignore the absent field. No migration needed.
- **No weapon interaction** means a 2H warrior using Power Strike gets the same damage as an unarmed one. This is intentional in Phase 1.

## Implementation Order

1. Add the six T0 entries + type-union update in `class-abilities.ts` (compile breaks until step 2).
2. Add the unified handler in `combat-tick/index.ts` next to the existing ability handlers.
3. Delete every Focus Strike reference, working from the grep list above. Compile clean.
4. Verify the mirrored Deno `combat.ts` is in sync (no `focusStrikeDmg`).
5. Smoke test in the Heaven testing region: each class queues its T0 against a creature, confirms a single damage event lands on the next tick at the expected magnitude, CP is deducted, and the creature dies cleanly when HP hits 0.
6. Quick visual check that the buff strip and party panel no longer show a Focus Strike row.

## Phase 2 Follow-ups (not in this task)

- T0s usable as out-of-combat openers (queued, resolve on next tick after `startCombat`)
- First-cast-free in a fight
- Backstab ×2 opener bonus
- Power Strike stun, Cutting Words taunt, Fireball minor splash
- Cast-bar UI and movement-interrupt
- Save a `mem://game/class-abilities/t0` note documenting the final formula and per-class behavior
