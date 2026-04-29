## Goal

Replace the generic `⏳ 🔥 Fireball...` queued-ability log line for T0 openers with class-specific flavor text that names the target, e.g. `⏳ 🔥 You begin shaping a ball of arcane flame at Goblin...`.

## Where the change lives

All T0 queue text is generated in one place: `getQueueFlavour()` in `src/features/combat/hooks/useCombatActions.ts` (around lines 45–58). It's the `default` branch that produces today's `⏳ {emoji} {label}...` line — none of the T0 ability types (`fireball`, `power_strike`, `aimed_shot`, `backstab`, `smite`, `cutting_words`) have an explicit case yet, so they all fall through to it.

This is the only spot that needs editing. The server already logs the actual hit/miss line on tick resolution, so behavior is unchanged — only the cast-start line gets nicer text.

## Proposed flavor lines

Each T0 gets a case in the `switch`. `${target}` is `creatureName || 'your target'` (already passed in).

- `fireball` → `⏳ 🔥 You begin shaping a ball of arcane flame at ${target}...`
- `power_strike` → `⏳ ⚔️ You wind up a heavy strike at ${target}...`
- `aimed_shot` → `⏳ 🎯 You take careful aim at ${target}...`
- `backstab` → `⏳ 🗡️ You slip into the shadows behind ${target}...`
- `smite` → `⏳ ⭐ You call down divine light upon ${target}...`
- `cutting_words` → `⏳ 🎵 You ready a barbed insult for ${target}...`

(Wording is suggested — easy to tweak. Emoji stays consistent with each ability's existing emoji in `CLASS_ABILITIES`.)

## Out of scope

- No server changes (`combat-tick` already produces the resolution log line).
- No changes to non-T0 ability flavor lines (`heal`, `dot_debuff`, etc. already have their own cases).
- No changes to log coloring (the `⏳` prefix already triggers the muted-italic style in `combat-log-utils.ts`).

## File to edit

- `src/features/combat/hooks/useCombatActions.ts` — add 6 `case` branches inside `getQueueFlavour`.