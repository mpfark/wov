# Event Log Visual Consistency Pass

## Goal
Keep all flavorful MUD wording exactly as it is today. Replace the ad-hoc, emoji-keyword color map in `combat-log-utils.ts` with a small, centralized **category-based style system** so every line in the Event Log shares a consistent color hierarchy, typography, spacing, and emphasis.

No gameplay or wording changes. Pure presentation refactor inside `src/features/combat/`.

---

## What changes for the player

- All player actions read in one consistent warm gold/amber tone.
- Incoming enemy hits read in one muted red tone.
- Heals/support read in one pale teal tone, buffs in muted violet, loot in soft gold, system/travel in dim blue-grey.
- DoTs (bleed/poison/burn) keep their identity but with normalized intensity.
- Damage and heal **numbers** become the only strongly emphasized token in normal lines.
- Crits, killing blows, level-ups, legendary loot keep stronger styling — but only those.
- Repeated passive-trigger lines (retaliation, shield procs, remote DoTs) render slightly dimmer than the player's own active actions.
- Tighter line height, consistent left padding, subtle separators between events.
- One icon per line at a normalized size and opacity; no oversized glow stacks.

The wording (`🔥 Your Holy Shield sears the Stillpoint Sentry for 53 holy damage!`) is unchanged.

---

## Categories

Single source of truth for visual identity:

```text
EVENT_STYLE = {
  player_attack    → warm gold/amber
  enemy_attack     → muted red
  heal             → pale teal
  holy             → pale teal / soft white
  fire             → warm ember
  poison           → muted green
  bleed            → muted blood red
  shadow           → muted violet
  buff             → muted violet
  mitigation       → dim blue-grey (block/absorb)
  loot             → soft gold
  renown / xp      → soft gold (subtle)
  level_up / crit  → primary, bold (reserved emphasis)
  system / travel  → dim blue-grey
  whisper          → muted purple
  remote / passive → 0.6–0.7 opacity variant of base category
}
```

Each category resolves to: `{ textClass, iconClass, numberClass, emphasis: 'normal' | 'strong' }`.

---

## Technical Direction

### New file: `src/features/combat/utils/event-log-styles.ts`
- Exports `EventLogCategory` type and `EVENT_STYLE` map (Tailwind class strings only — all colors via existing semantic tokens in `index.css` / `tailwind.config.ts`; no new hex).
- Exports `classifyLogLine(log: string): { category, isRemote, isCrit, isKill }` — a pure function that takes the existing string log entries and decides their category. It absorbs and replaces the giant `if/else` chain currently inside `combat-log-utils.ts#getLogColor`.
- Exports `splitLogTokens(log: string): { icon, body, number }` — light parser that pulls:
  - leading emoji (first grapheme) → `icon`
  - trailing damage/heal value, matched against patterns already produced by `combat-text.ts` (`[NN]`, `for NN damage`, `restores NN HP`, `blocks NN`) → `number`
  - everything else → `body`
- Returns the original string untouched if no number is found, so wording is preserved.

### Tokens to add in `src/index.css`
A small number of new HSL CSS variables, each used by the new style map:
- `--log-player`, `--log-enemy`, `--log-heal`, `--log-holy`, `--log-fire`, `--log-poison`, `--log-bleed`, `--log-shadow`, `--log-buff`, `--log-mitigation`, `--log-loot`, `--log-system`, `--log-number-damage`, `--log-number-heal`, `--log-number-block`.
- Several reuse existing tokens (`--gold`, `--blood`, `--elvish`, `--dwarvish`, `--dot-*`) where the hue already matches; only add new variables when no existing one fits.
- Mirror in `tailwind.config.ts` under `colors.log.*` so utility classes like `text-log-player`, `text-log-enemy`, `text-log-number-damage` are available.

### Refactor: `src/features/combat/utils/combat-log-utils.ts`
- `getLogColor` becomes a thin shim that calls `classifyLogLine` then returns `EVENT_STYLE[category].textClass` (kept for any external caller). Internal cache stays.
- No more emoji-keyword color decisions live here.

### Refactor: `src/features/combat/components/EventLogPanel.tsx`
- For each entry, call `classifyLogLine` + `splitLogTokens`, then render:
  ```tsx
  <p className={cn('event-log-line', style.textClass, style.emphasis === 'strong' && 'font-semibold', isRemote && 'opacity-60')}>
    {icon && <span className={cn('event-log-icon', style.iconClass)}>{icon}</span>}
    <span className="event-log-body">{body}</span>
    {number && <span className={cn('event-log-number', style.numberClass)}>{number}</span>}
  </p>
  ```
- Add small CSS rules in `index.css` (or scoped in the panel) for `.event-log-line` (line-height, left padding, subtle bottom separator at 1px `border-border/30`), `.event-log-icon` (fixed width, vertical-align baseline, `opacity-80`), and `.event-log-number` (slightly heavier weight, 1.05× size).
- The existing `---tick---` separator continues to render as the divider it already is.
- The display-mode toggle (`numbers` / `words` / `both`) is untouched — it still controls `combat-text.ts` formatting upstream.

### Repeated/passive dimming
- Inside `classifyLogLine`, the existing `(remote)` substring detection becomes `isRemote = true` and the renderer applies a single `opacity-60` modifier instead of the current bespoke per-emoji classes.
- DoT ticks (bleed/poison/burn) without a player-source verb classify as `passive`, rendered at one intensity step lower than `player_attack`.

### Crit / killing blow / level-up / loot emphasis
- `classifyLogLine` flags `isCrit` (line contains `CRITICAL!` or starts with `💥`), `isKill` (`💀`, `been defeated`, `struck down`), `isLevelUp` (`🎉` or `Level Up`), and rare-loot (`🏆`, `Legendary`, `Soulforged`).
- These map to `emphasis: 'strong'` and use `text-primary` / `text-glow` (existing) — **only** these get the brighter treatment.

### What stays untouched
- `combat-text.ts` — wording, tier words, flavor sentences, weapon emoji, boss flavor.
- All emitters in `useGameLoop`, `useCombatActions`, `usePartyCombatLog`, `useConsumableActions`, etc. — they keep producing the same strings.
- The `numbers / words / both` toggle behavior.
- Server logs, broadcast payloads, persisted activity logs.

---

## File-by-file impact

| File | Change |
|---|---|
| `src/features/combat/utils/event-log-styles.ts` | **new** — categories, style map, `classifyLogLine`, `splitLogTokens` |
| `src/features/combat/utils/combat-log-utils.ts` | reduce `getLogColor` to a shim over the new classifier |
| `src/features/combat/components/EventLogPanel.tsx` | render structured icon/body/number spans; apply category + remote dimming |
| `src/index.css` | add `--log-*` HSL tokens; add `.event-log-line/.event-log-icon/.event-log-number` rules |
| `tailwind.config.ts` | expose `colors.log.*` to match the new tokens |

No edits to combat hooks, server functions, or wording producers.

---

## Out of scope

- Any change to the wording, verbs, flavor, or tier-word system in `combat-text.ts`.
- Any change to what the server emits or what gets stored in activity/combat logs.
- Filtering, collapsing, or grouping of repeated lines (beyond opacity dimming for `(remote)` / passive).
- New animations or motion effects.
- Sound or haptic cues.

---

## Success Criteria

- Every entry in the Event Log resolves to exactly one of the categories in `EVENT_STYLE` and uses its color/icon/number classes — no orphan ad-hoc colors.
- Player lines, enemy lines, heals, buffs, loot, and system lines each share one consistent tone across all sources.
- Damage and heal numbers are the strongest visible token in normal lines; everything else reads as calm body text.
- Crits, killing blows, level-ups, and legendary/soulforged drops are the only lines with `font-semibold` / glow emphasis.
- Remote / passive ticks render at reduced opacity without losing their category identity.
- The MUD wording is byte-identical to today; only colors, weights, spacing, and icon sizes change.
