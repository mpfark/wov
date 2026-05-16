# Feature-Based Folder Structure

This directory organizes the game's frontend code by **domain/feature** rather than by file type.

## Principles

1. **Feature-first**: Each folder groups hooks, components, utilities, and types that belong to a single game domain.
2. **Barrel exports**: Each feature has an `index.ts` that re-exports its public API. Import from the barrel (`@/features/combat`) rather than reaching into internal paths when possible.
3. **Shared code stays shared**: Truly cross-cutting concerns live outside features:
   - `src/hooks/` — auth, roles, global presence, actions, game events
   - `src/lib/` — game-data constants, generic utilities, worker timer
   - `src/components/ui/` — reusable UI primitives (shadcn)
   - `src/components/game/` — shared game chrome (heartbeat, debug overlay, dialogs)
   - `src/integrations/` — external service clients (Supabase)

## Feature Folders

| Folder | Domain | Key exports |
|--------|--------|-------------|
| `combat/` | Combat engine, buffs/debuffs, class abilities | `usePartyCombat`, `useGameLoop`, combat-math formulas |
| `party/` | Party management and broadcast sync | `useParty`, `usePartyBroadcast` |
| `world/` | World navigation, nodes, maps, areas | `useNodes`, `useNodeChannel`, `MapPanel` |
| `character/` | Character state and progression | `useCharacter`, `CharacterPanel` |
| `creatures/` | Creatures and NPCs | `useCreatures`, `useNPCs` |
| `inventory/` | Items, equipment, vendors, loot | `useInventory`, `useItemCache` |
| `chat/` | In-game messaging | `useChat` |

## Where to put new code

- **New combat buff?** → `features/combat/hooks/useGameLoop.ts` (buff types) + `hooks/useActions.ts` (activation logic)
- **New item type?** → `features/inventory/`
- **New map feature?** → `features/world/`
- **Shared utility used by 3+ features?** → `src/lib/`
- **Admin panel code?** → `src/components/admin/` (separate domain)

## Typography & rhythm

The UI uses **five named text roles** and **four spacing tokens** defined in `src/index.css`. Prefer these over ad-hoc Tailwind sizes so panels stay visually consistent.

### Text roles

| Class | Use |
|---|---|
| `t-display-lg` | Panel/page title (one per panel). Only role that uses gold glow. |
| `t-display-sm` | Section header inside a panel. |
| `t-label` | Metadata labels, tab labels, group captions. The only place uppercase + tracking is used. |
| `t-body` | Default readable prose, descriptions, log lines. |
| `t-meta` | Secondary info: timestamps, counts, footnotes. |
| `t-numeric` | Any displayed number (stats, gold, HP). Tabular figures for column alignment. Combine with `t-numeric-pos` / `t-numeric-neg` / `t-numeric-cap` for sign/dim variants. |

Rules: only `t-display-lg` glows. `italic` is reserved for tooltip flavor + combat narrative. Don't use `text-foreground/70`-style opacity as a color — use `t-meta` or `opacity-60` (whole element).

### Spacing rhythm

| Class | Gap | Use |
|---|---|---|
| `gap-row`     | 4px  | Items in a tight list (stat rows, log lines) |
| `gap-group`   | 8px  | Between groups inside a section (identity / stats / flavor) |
| `gap-section` | 16px | Between sections inside a panel |
| `gap-panel`   | 24px | Between top-level panel blocks |

Panel padding: `p-3` (compact panels), `p-4` (service panels). Dividers: `h-px bg-border/60`.

The Event Log keeps its own `event-log-*` classes — the `t-*` system coexists.

