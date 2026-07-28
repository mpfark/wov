# Event Log Redesign — Phases 1 & 2

Presentation-layer only. No emitter rewrites, no schema/backend changes, no structured events, no filters.

## Approach

One shared module owns classification + presentation. Both `EventLogPanel` and `ChatPanel` consume it, but chat keeps its own conversational look (no left edge, no combat colours).

```text
raw log string
      │
      ▼
event-log-styles.ts   (extended, single source of truth)
  classifyLogLine()   → existing 20 fine-grained categories  (unchanged, keeps routing/tests safe)
      │
      ▼
  toPresentation()    → { family, marker, hideIcon, edgeClass, textClass, numberClass, urgent }
      │                  5 visual families only
      ▼
splitLogTokens()      → { icon, body, number }   (unchanged; leading-emoji run + numeric tail)
      │
      ├── <EventLogLine>  shared renderer → used by EventLogPanel
      └── ChatPanel       uses classify + a chat-specific line style
```

## Visual families (5)

| Family | Covers | Left edge |
|---|---|---|
| `action` | player attacks, abilities, passive | muted steel |
| `threat` | enemy attacks, incoming damage, bleed/fire/poison/shadow taken | dark ember |
| `support` | heal, holy, buff, mitigation | muted verdant |
| `ambient` | system, movement, xp, ordinary loot, neutral, unknown/legacy | faint parchment (near-invisible) |
| `notable` | crit, kill/death, level_up, boss telegraph, unique/legendary loot, quest, errors | gold accent |

Narrow left edge (2px) is the primary indicator. Body text stays close to current readable foreground with a family tint; numbers keep their current suffix position and get restrained weight + family colour. Colour is never the only signal — the marker glyph, wording and weight carry meaning too.

## Icon policy

- **Hidden at render time**: every leading emoji run detected by `splitLogTokens` for routine families (`action`, `threat`, `support`, `ambient`). The string itself is untouched — classification, routing, dedup, broadcast and stored history all keep working exactly as today.
- **Visible marker**: only for `notable`, and only as a monochrome `lucide-react` glyph chosen from the fine-grained category — `Skull` (death/kill), `ChevronsUp` (level up), `Sparkles` (rare/unique/legendary loot), `ScrollText` (quest), `Zap` (boss telegraph/urgent cast), `TriangleAlert` (important error). No colourful replacements.
- **Embedded emoji** (mid-sentence, authored dialogue, boss flavour, item names) is never touched — only the leading run is suppressed, never a global strip.
- **Multiple leading tokens** are already captured as one run by the existing regex; the whole run is suppressed together.
- **Chat/whisper** keeps its `💬`/`🤫` prefix suppressed too but renders with the existing conversational styling.
- **Historical / legacy / unclassifiable** lines fall through to `ambient` and render as plain readable text with no marker — a safe no-op.

## Urgent treatment

`notable` + `urgent` (boss telegraph, death) gets a one-shot ~600ms fade-in of the left edge via a CSS keyframe (`animation-iteration-count: 1`), wrapped in `@media (prefers-reduced-motion: reduce)` to disable. No continuous pulsing. The existing continuous `.log-crit` text-shadow is replaced by this one-shot treatment.

## Files changed

| File | Change |
|---|---|
| `src/features/combat/utils/event-log-styles.ts` | Add `EventLogFamily`, `PRESENTATION` map, `toPresentation(classified)`, marker resolution. Keep `classifyLogLine` and `splitLogTokens` behaviour byte-identical. |
| `src/features/combat/components/EventLogLine.tsx` *(new)* | Shared line renderer: edge + optional marker + body + number. Takes a `variant` (`log` \| `chat`). |
| `src/features/combat/components/EventLogPanel.tsx` | Render via `EventLogLine`; keeps `stripFlavorNumber`, newest-at-top, tick divider, font-size classes. |
| `src/features/chat/components/ChatPanel.tsx` | Render via `EventLogLine` with `variant="chat"` — no left edge, no combat tint, speech/whisper styling preserved. |
| `src/features/combat/utils/combat-log-utils.ts` | `getLogColor` re-implemented on top of `toPresentation` so no second styling path exists. Signature unchanged. |
| `src/index.css` | New `--log-edge-*` semantic tokens, `.event-log-edge`, one-shot `log-urgent` keyframe + reduced-motion guard. Keep existing `.event-log-*` layout classes. |
| `tailwind.config.ts` | Map the new edge tokens (only if not already expressible). |
| `src/features/combat/utils/__tests__/event-log-styles.test.ts` *(new)* | Cover: single leading emoji, multi-emoji run, embedded emoji preserved, legacy/unknown → ambient, notable families keep markers, `icon+body+number === input`. |

Untouched: all emitters, `combat-tick`, `combat-catchup`, `proc-log-format.ts`, `useGameEvents`, `GamePage` routing/dedup/`processIncomingLog`, party broadcast, DB.

## Phase 2 note on routing

`GamePage`'s `startsWith('💬'|'🤫')` split is switched to `classifyLogLine(...).category === 'speech' | 'whisper'` — same outcome for every current message (those categories are defined by exactly those prefixes), but it removes the last behavioural dependency on emoji so a future emitter change can't break chat routing. Everything else about routing and ordering stays as-is.

## Verification

- Vitest run for the new classifier/presentation tests plus the existing suite.
- `tsgo` typecheck.
- Playwright pass on the running app: enter the world, capture the event log at desktop and mobile viewports, confirm no routine emoji renders, markers appear only on notable lines, chat panel still reads as conversation, and both display modes (flavor / flavor+numbers) and all font sizes render correctly.

## Out of scope (later phases)

Structured event payloads on the bus, configurable filters, server/client combat-sentence deduplication, moving numbers inline.
