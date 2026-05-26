## Goal

Add two layers of flavor text:

1. **Cast-time flavor** when a damage/heal ability is queued (replaces the silent "button pulses only" state).
2. **Stance activation/drop flavor** — replace the generic `"Holy Shield activated! Reserves N CP…"` line with themed sentences.

Both are client-side, single-line additions to the event log. Mechanics are untouched.

---

## 1. Cast-time flavor line

Currently in `useCombatActions.ts` the queue path (~line 273-281) intentionally writes nothing — only the button pulses. We'll add a single `p.addLog(...)` right before `p.queueAbility(...)` for queued (non-instant) abilities, picking text from a per-ability table keyed by `ability.type`. The line uses the format already established by the event-log rework:

`{emoji} {flavor sentence}`  *(no `[N]` — cast-time has no damage yet)*

Target name is resolved from the same `resolveCreatureTarget` call already in scope. If no creature target (heals / party regen), we substitute `yourself` / `your allies` per ability type.

### Proposed cast lines (one short, evocative sentence each)

T0 openers (class identity):
- `smite` (healer / templar Judgment) — `"✝️ You raise your hand and call judgment down on {target}…"` (templar) / `"⭐ You channel divine light toward {target}…"` (healer). We branch on `character.class` since both share `type: 'smite'`.
- `fireball` — `"🔥 You weave arcane flame between your fingers, aimed at {target}…"`
- `power_strike` — `"⚔️ You set your stance and ready a crushing blow against {target}…"`
- `aimed_shot` — `"🎯 You draw, breathe, and steady your aim on {target}…"`
- `backstab` — `"🗡️ You slip behind {target}, blade reversed…"`
- `cutting_words` — `"🎵 You take a breath, voice sharpening for {target}…"`

Higher-tier server-resolved abilities:
- `multi_attack` (Barrage) — `"🏹 You nock three arrows and draw, sighting {target}…"`
- `dot_debuff` (Rend) — `"🩸 You ready a tearing cut across {target}…"`
- `sunder_debuff` — `"🔨 You wind back to crush {target}'s guard…"`
- `execute_attack` (Eviscerate) — `"🔪 You coil to detonate the venom in {target}…"`
- `ignite_consume` (Conflagrate) — `"💥 You reach out to ignite the embers burning {target}…"`
- `burst_damage` (Grand Finale) — `"💥 You inhale, the final chord rising toward {target}…"`
- `hp_transfer` — `"💉 You open a vein of life, willing it toward {ally}…"`
- `heal` — `"💚 You gather warm light around yourself…"`
- `self_heal` (Second Wind) — `"💪 You plant your feet and catch your breath…"`

Instant-resolve buffs/debuffs (`INSTANT_BUFF_TYPES`) keep silent — they post their result line immediately, so no pre-cast text is needed.

### Implementation sketch

```ts
// new file: src/features/combat/utils/cast-flavor.ts (pure)
export function getCastFlavor(
  abilityType: string,
  characterClass: string,
  targetName: string | null,
): string | null { ... }
```

Hook it in `useCombatActions.handleUseAbility` immediately before `p.queueAbility(...)`:

```ts
const targetName = queueTargetId
  ? p.creatures.find(c => c.id === queueTargetId)?.name ?? null
  : null;
const flavor = getCastFlavor(ability.type, p.character.class, targetName);
if (flavor) p.addLog(flavor);
p.queueAbility(abilityIndex, queueTargetId);
```

---

## 2. Stance activation / drop flavor

Replace the two existing generic log lines (`useCombatActions.ts` lines 207 and 236) with stance-specific text. The reserved-CP info stays — but as a short parenthetical so the flavor reads first.

Per stance (activation / drop):

| Stance | Activate | Drop |
|---|---|---|
| Holy Shield | `"⚡ Radiant wards flare around you — Holy Shield burns ready. ({cost} CP reserved.)"` | `"⚡ The radiant wards dim and fade. (Reserved CP is not refunded.)"` |
| Force Shield | `"🛡️ Threads of arcane light braid into a shimmering barrier. ({cost} CP reserved.)"` | `"🛡️ The arcane barrier unravels into motes. (Reserved CP is not refunded.)"` |
| Eagle Eye | `"🦅 Your vision narrows — every flaw in your foe stands out. ({cost} CP reserved.)"` | `"🦅 The world widens again as Eagle Eye fades. (Reserved CP is not refunded.)"` |
| Arcane Surge | `"✨ Arcane current crackles down your arms. ({cost} CP reserved.)"` | `"✨ The arcane current ebbs and stills. (Reserved CP is not refunded.)"` |
| Battle Cry | `"📯 You bellow a battle cry — your blood runs cold and steady. ({cost} CP reserved.)"` | `"📯 Your battle cry falls silent. (Reserved CP is not refunded.)"` |
| Shield Wall | `"🛡️ You plant your shield and root your stance. ({cost} CP reserved.)"` | `"🛡️ You ease out of Shield Wall stance. (Reserved CP is not refunded.)"` |
| Ignite | `"🌋 Embers gather at your fingertips, waiting to leap. ({cost} CP reserved.)"` | `"🌋 The embers gutter out. (Reserved CP is not refunded.)"` |
| Envenom | `"🐍 You coat your blade in slow, dark venom. ({cost} CP reserved.)"` | `"🐍 You wipe the last of the venom from your blade. (Reserved CP is not refunded.)"` |

### Implementation sketch

Extend `src/features/combat/utils/stances.ts` with:

```ts
export function getStanceActivateFlavor(key: StanceKey, cost: number): string
export function getStanceDropFlavor(key: StanceKey): string
```

— each backed by a `Record<StanceKey, {activate, drop}>` table. Swap the two `p.addLog(...)` calls in `useCombatActions.ts` to use them.

---

## Files touched

- `src/features/combat/utils/cast-flavor.ts` *(new, pure)*
- `src/features/combat/utils/stances.ts` *(+flavor table & helpers)*
- `src/features/combat/hooks/useCombatActions.ts` *(2 stance log lines swapped; 1 cast-flavor line added before `queueAbility`)*

No server, schema, or formula changes. No behavior changes.