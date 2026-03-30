# State Ownership Guide

This document explains how state is classified in the frontend and where each kind of state should live.

## State Categories

### 1. Server-Authoritative State
**Canonical game state stored in the database / server functions.**
The server is the single source of truth. The client MUST NOT simulate or guess these values.

| Data | Owner | Notes |
|------|-------|-------|
| Character HP, XP, gold, level, stats | Database (characters table) | Updated via `updateCharacter` |
| Creature HP | Database (creatures table) | Updated via `damage_creature` RPC |
| Active effects / DoTs | Database (active_effects table) | Server ticks effects; client syncs display |
| Combat sessions | Database (combat_sessions table) | Server creates/manages via combat-tick |
| Inventory contents | Database (character_inventory) | Fetched, not locally simulated |
| Party membership | Database (parties, party_members) | Server-managed |
| Character position (node) | Database (characters.current_node_id) | Server-authoritative |

### 2. Fetched / Cached Client State
**Server-owned state mirrored in React for rendering.**
Uses React Query, Supabase realtime subscriptions, or manual fetch.

| Data | Source | Update Pattern |
|------|--------|----------------|
| Character record | Realtime subscription | Auto-syncs via `useCharacter` |
| Creature list per node | Fetch + realtime | `useCreatures` refetches on node change |
| Ground loot | Fetch + broadcast | `useGroundLoot` |
| Nodes / regions / areas | Fetch (cached) | `useNodes` loads once |
| Party members + status | Fetch + realtime | `useParty` |
| Vendor/NPC data | Fetch per node | On-demand |

### 3. Local UI State
**Temporary state used only for presentation or interaction.**
Never persisted. Lost on refresh. Does not affect game simulation.

| Data | Location | Purpose |
|------|----------|---------|
| selectedTargetId | GamePage | Which creature the player has tab-targeted |
| Panel open/close states | GamePage | Sheet/drawer visibility |
| Event log | GamePage | Local display-only message buffer |
| Chat input | GamePage | Current typed text |
| Death countdown | useGameLoop | 3-2-1 display timer |
| Regen tick flash | useGameLoop | Brief UI indicator |
| Buff display state | **useBuffState** | Local copies synced from server for rendering |

### 4. Derived State
**Values computed from authoritative or cached data.**
Should be `useMemo` or inline computation — never stored in separate state.

| Data | Derived From | Location |
|------|-------------|----------|
| effectiveAC | class + DEX + gear + acBuff | GamePage |
| effectiveMaxHp | max_hp + gear HP + gear CON | GamePage |
| inCombat | combat session existence | usePartyCombat |
| mergedCreatureHpOverrides | combat-tick + broadcast | useMergedCreatureHpOverrides |
| equipped/unequipped split | inventory + equipped_slot | useInventory |
| equipmentBonuses | equipped item stats | useInventory |

## Buff State Architecture

Buff/debuff display state lives in `useBuffState` (src/features/combat/hooks/useBuffState.ts).

**Why local state instead of server-fetched?**
Buffs are applied instantly on ability use (for responsive UI) and synced from server DoT data
via `syncFromServerEffects`. The server is authoritative for *simulation* (damage ticks, expiry),
but the client maintains its own copy for *display* (showing buff icons, stack counts, timers).

**Data flow:**
```
Player uses ability → local buff state set immediately (responsive UI)
                    → server receives buff info via gatherBuffs() in combat-tick
                    → server processes effects
                    → server returns active_effects
                    → syncFromServerEffects() updates local stacks from server truth
```

## Decision Guidelines

| Question | Answer |
|----------|--------|
| Does this affect game simulation? | → Server owns it |
| Does this affect display only? | → Local UI may own it |
| Is it computable from other state? | → Derive it, don't store it |
| Is it temporary interaction state? | → Local UI state |
| Should it survive page refresh? | → Server or database |
| Do multiple users need to see it? | → Server + broadcast |

## Where New Files Should Go

- **Server query hooks** → `src/features/<feature>/hooks/` (e.g., `useCreatures.ts`)
- **Local UI state hooks** → `src/features/<feature>/hooks/` (e.g., `useBuffState.ts`)
- **Pure helpers / selectors** → `src/features/<feature>/utils/` (e.g., `mapServerEffectsToBuffState.ts`)
- **Derived state selectors** → `src/features/<feature>/hooks/` (e.g., `useMergedCreatureState.ts`)
- **Cross-cutting shared hooks** → `src/hooks/` (e.g., `useAuth.ts`, `useActions.ts`)
- **Shared game formulas** → `src/lib/game-data.ts`
