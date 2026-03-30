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
