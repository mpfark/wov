
## Goal

Make the Event Log feel consistent. Today there are three modes (Numbers / Words / Both) and three different sentence styles depending on which code path emitted the line. Going forward:

- Two modes only: **Flavor** and **Flavor + Numbers**.
- Every combat/ability/mitigation event uses the same shape:
  `{emoji} {flavor sentence} [N]`
- In **Flavor** mode, the trailing `[N]` is stripped automatically. In **Flavor + Numbers** it is shown.
- Inline numbers ("for 65 holy damage", "−12 damage, 80 → 68", "restores 45 HP", "1d8 + 3 STR…") are removed from the flavor sentence itself.

## Examples (before → after)

Holy Shield retaliation
- Before: `⚡ Your Holy Shield burns Grey-Tuft Brawler for 65 holy damage!`
- After (Flavor+N): `⚡ Your Holy Shield burns Grey-Tuft Brawler! [65]`
- After (Flavor): `⚡ Your Holy Shield burns Grey-Tuft Brawler!`

Shield block + the hit that lands
- Before: `🛡️ You block with shield! (−12 damage, 80 → 68)` followed by `👹 Brawler strikes you ... — 68 damage.`
- After (Flavor+N): `🛡️ You raise your shield and turn the blow! [12]` then `👹 Brawler crushes you, battering you. [68]`
- After (Flavor): same without the brackets.

Heals / restores
- `💚 Healer mends your wounds! [45]`
- `🔆 Consecrated ground soothes Ally. [12]`

Ability hits (Rend, Eviscerate, Grand Finale, Barrage arrow, off-hand, etc.)
- `🩸 You rend Brawler — blood weeps from the gash! [9/tick]`
- `🔪 You eviscerate Brawler, consuming 3 poison stacks! [142]`
- `🗡️ Your off-hand finds an opening! [22]`

Misses / dodges / awareness keep their flavor, no `[N]`.

## Scope

### 1. Event Log UI — drop the third mode
- `src/features/combat/utils/combat-text.ts`: `CombatLogDisplayMode` becomes `'flavor' | 'flavor_numbers'`. `getStoredDisplayMode` migrates old values (`numbers` → `flavor_numbers`, `words` → `flavor`, `both` → `flavor_numbers`).
- `EventLogPanel.tsx`: button cycles between two modes. Labels `F` / `F+N`.
- A new pure helper `stripFlavorNumber(line)` removes a single trailing ` [\d+]` (and the matching `[N]` inside special suffixes like `[9/tick]`) when mode is `flavor`. Applied uniformly to every rendered line.

### 2. Standardize all server-side combat messages
File: `supabase/functions/combat-tick/index.ts` (plus `_shared/combat-resolver.ts` for DoT verbs). Every `events.push({ ..., message })` is rewritten so the message is `flavor sentence` + optional ` [N]` suffix. No inline "for X damage", "restores X HP", "(−X damage, A → B)", "Rolled d20 + ... vs AC ...".

Affected messages (non-exhaustive, grouped):

- Holy Shield retaliation → `⚡ {targetName}'s Holy Shield burns {creature}! [N]`
- Shield block → `🛡️ {target} raises their shield and turns the blow! [Nblocked]`
- Absorb shield → `🛡️ A shimmering ward soaks the strike for {target}! [N]`
- Battle Cry DR → `📯 {target}'s war cry softens the blow! [Nreduced]`
- Divine Challenge DR → `⚜️ {target}'s Divine Challenge mitigates the strike! [Nreduced]`
- Creature hit / crit / miss → continues to go through `formatCombatEvent` (already structured). Roll-math text is removed; trailing `[N]` is added in the formatter.
- Player attack / off-hand → same, roll math gone, flavor sentence + `[N]`.
- Rend bleed apply → `🩸 {c} rends {target} — blood weeps from the gash! [Nper tick]`
- Eviscerate / Detonate burns / Barrage arrow / Ignite pulse / Grand Finale → flavor + `[N]`.
- Consecrate tick heal → `🔆 Consecrated ground soothes {ally}. [N]`
- Consecrate tick burn → `🔆 Holy fire sears {creature}. [N]`
- DoT ticks (`combat-resolver.ts`): `🩸/🧪/🔥 {target} suffers {effect_type}. [N]` (the renderer already routes by emoji to the right category).

### 3. Stat number colors stay intact

`splitLogTokens` and `EVENT_STYLE.*.numberClass` already color the trailing token. The simplified `[N]` matches the existing `\s\[\d+\][.!]?` branch of `NUMBER_TAIL_RE`, so coloring keeps working without further changes. The legacy "for X damage" / "restores X HP" branches can be deleted later — kept now for safety while older queued events drain.

### 4. Lore / tone of the new flavor strings

- Player attacks already use the tier-word + flavor system in `combat-text.ts` — that stays.
- Block / absorb / DR / retaliation each get 2-3 randomized flavor variants picked at render time (kept on the server for simplicity, one variant per event). Tone matches the existing dark-fantasy parchment voice.

### 5. Out of scope (suggestions for later, not in this change)

- Coloring the bracket differently per category (e.g. block = blue, heal = green) — already handled by `numberClass` per category, free.
- Showing `+N` for heals vs `-N` for damage. Could be added as a sign convention later; for now `[N]` is uniform.
- Migrating chat / system / loot lines — they don't carry combat numbers, untouched.

## Files

- `src/features/combat/utils/combat-text.ts` — type + mode migration + `stripFlavorNumber`.
- `src/features/combat/components/EventLogPanel.tsx` — two-mode toggle, strip numbers in flavor mode.
- `src/features/combat/utils/event-log-styles.ts` — no logic change; verify `NUMBER_TAIL_RE` covers `[N]` only (it already does).
- `supabase/functions/combat-tick/index.ts` — rewrite every `message:` listed above.
- `supabase/functions/_shared/combat-resolver.ts` — rewrite DoT tick message to flavor + `[N]`.
- `src/features/combat/utils/event-log-styles.ts` tests / `combat-text.ts` tests — add a small unit test for `stripFlavorNumber` (covers `[12]`, `[12].`, `[12]!`, multi-bracket like `[3/tick]`).

## Notes for the technical implementation

- `getStoredDisplayMode` performs a one-time migration so existing localStorage keys don't dump users into an unknown mode.
- Stripping is a single regex on the final rendered string, applied in `EventLogPanel` before `splitLogTokens`. This keeps `combat-text.ts` pure and avoids per-callsite branching.
- Server messages remain canonical (always include `[N]` where a number exists). The client decides whether to display the bracket. This means saved logs / replays remain useful in either mode.
