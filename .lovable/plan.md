

# Split useActions — Refined Plan with Internal Helper Extraction

## Architecture Overview

Three feature hooks replace `useActions`. Each hook is structured as: **pure helpers at top → hook orchestration below**. No helper is duplicated across hooks.

```text
src/features/combat/hooks/useCombatActions.ts
  ├─ helpers: resolveCreatureTarget(), getQueueFlavour(), INSTANT_BUFF_TYPES, COMBAT_REQUIRED_TYPES
  ├─ helpers: buildLevelUpUpdates(), awardPartySalvage(), awardPartyXpGold()
  ├─ hook: degradeEquipment, rollLoot, awardKillRewards, handleUseAbility, handleAttack

src/features/world/hooks/useMovementActions.ts
  ├─ helpers: resolveOpportunityAttacks(), moveFollowers()
  ├─ hook: handleMove, handleTeleport, handleReturnToWaymark, handleSearch
  ├─ state: waymarkNodeId, teleportOpen

src/features/inventory/hooks/useConsumableActions.ts
  ├─ hook: handleUseConsumable (small, no extraction needed)
```

---

## File 1: `src/features/combat/hooks/useCombatActions.ts` (~480 lines)

### Extracted pure helpers (top of file, outside hook)

**`INSTANT_BUFF_TYPES`** / **`COMBAT_REQUIRED_TYPES`** — module-level `Set` constants (lines 675-701, moved as-is)

**`getQueueFlavour(ability, creatureName?): string`** — pure function (lines 682-695, moved as-is)

**`resolveCreatureTarget(creatures, activeCombatCreatureId, targetId?): string | null`** — pure function extracted from current closure (lines 704-710), takes creatures array as param instead of closing over `p`

**`buildLevelUpUpdates(character, newLevel, equipmentBonuses, addLog): Partial<Character>`** — pure function extracting lines 219-287 (level-up stat recalc, class bonuses, milestone messages, soulwright whisper). Returns the updates object. This is the densest block in awardKillRewards and benefits most from extraction.

**`awardPartyXpGold(partyId, characterId, nodeId, totalXp, totalGold, splitCount): Promise<void>`** — async helper extracting lines 179-201 (fetch fresh members, award each via RPC). Keeps the party reward loop out of the main function.

**`awardPartySalvage(partyId, characterId, nodeId, creature, splitCount): Promise<number>`** — async helper extracting lines 307-333 (salvage calc + party distribution). Returns salvage earned.

### Hook body

- `degradeEquipment` — kept as-is (~20 lines, simple enough)
- `rollLoot` — kept as-is (~65 lines, already well-structured with loot-table vs legacy branches)
- `awardKillRewards` — calls `buildLevelUpUpdates`, `awardPartyXpGold`, `awardPartySalvage`, `rollLoot`. Shrinks from ~175 lines to ~60 lines of orchestration
- `handleUseAbility` — structured with early validation block, then ability type switch. Each case stays inline (1-8 lines each) since they're already simple. The switch is long but flat and scannable.
- `handleAttack` — 3 lines, unchanged

### Params interface (~18 props)

```typescript
interface UseCombatActionsParams {
  character: Character;
  updateCharacter: (u: Partial<Character>) => Promise<void>;
  updateCharacterLocal: (u: Partial<Character>) => void;
  addLog: (msg: string) => void;
  equipped: EquippedItem[];
  equipmentBonuses: Record<string, number>;
  creatures: any[];
  creatureHpOverrides: Record<string, number>;
  party: any;
  partyMembers: any[];
  inCombat: boolean;
  activeCombatCreatureId: string | null;
  startCombat: (id: string) => void;
  stopCombat: () => void;
  queueAbility: (index: number, targetId?: string) => void;
  isDead: boolean;
  xpMultiplier: number;
  fetchInventory: () => void;
  fetchGroundLoot: () => void;
  buffState: BuffState;
  buffSetters: BuffSetters;
  notifyCreatureKilled?: (creatureId: string) => void;
}
```

---

## File 2: `src/features/world/hooks/useMovementActions.ts` (~320 lines)

### Extracted pure helpers (top of file)

**`resolveOpportunityAttacks(params): { newHp: number; logs: string[]; shieldUpdate: ... }`** — pure function extracting lines 399-461 (the flee opportunity attack block). Takes character stats, creatures, buffs, AC, party members. Returns damage taken, log messages, and shield state changes. This is the most complex block in handleMove and benefits greatly from isolation and future testability.

**`moveFollowers(partyMembers, characterId, nodeId, isLeader): Promise<void>`** — async helper extracting the duplicated "move followers" pattern used in handleMove (lines 490-499), handleTeleport (lines 528-541), and handleReturnToWaymark (lines 563-575). Single implementation, three call sites.

### Hook body

- `handleMove` — orchestration: locked check → MP check → encumbrance → flee (calls `resolveOpportunityAttacks`) → node update → `moveFollowers`. Shrinks from ~160 lines to ~80 lines.
- `handleTeleport` — orchestration: validation → waymark set → node update → `moveFollowers`. ~35 lines.
- `handleReturnToWaymark` — orchestration: validation → node update → `moveFollowers`. ~30 lines.
- `handleSearch` — kept as-is (~70 lines, self-contained with clear structure)
- State: `waymarkNodeId`, `teleportOpen`

### Params interface (~22 props)

```typescript
interface UseMovementActionsParams {
  character: Character;
  updateCharacter: (u: Partial<Character>) => Promise<void>;
  addLog: (msg: string) => void;
  equipped: EquippedItem[];
  unequipped: UnequippedItem[];
  equipmentBonuses: Record<string, number>;
  getNode: (id: string) => any;
  getRegion: (id: string) => any;
  getNodeArea: (node: any) => any;
  currentNode: any;
  creatures: any[];
  party: any;
  partyMembers: any[];
  isLeader: boolean;
  myMembership: any;
  inCombat: boolean;
  activeCombatCreatureId: string | null;
  fleeStopCombat: () => void;
  effectiveAC: number;
  isDead: boolean;
  broadcastMove: (...) => void;
  broadcastHp: (...) => void;
  toggleFollow: (v: boolean) => Promise<void>;
  fetchInventory: () => void;
  fetchParty: () => void;
  buffState: BuffState;
  buffSetters: BuffSetters;
  degradeEquipment: () => Promise<void>;
  unlockedConnections?: Map<string, number>;
  onUnlockPath?: (...) => void;
}
```

---

## File 3: `src/features/inventory/hooks/useConsumableActions.ts` (~30 lines)

No helper extraction needed — the hook is already tiny. One function, six params.

```typescript
interface UseConsumableActionsParams {
  character: Character;
  updateCharacter: (u: Partial<Character>) => Promise<void>;
  addLog: (msg: string) => void;
  equipmentBonuses: Record<string, number>;
  useConsumable: (...) => Promise<any>;
  buffSetters: Pick<BuffSetters, 'setRegenBuff' | 'setFoodBuff'>;
}
```

---

## File 4: `src/pages/GamePage.tsx` changes

Replace single `useActions()` call with three hook calls:

```typescript
const combatActions = useCombatActions({ /* ~18 params */ });
const movementActions = useMovementActions({
  /* ~22 params */
  degradeEquipment: combatActions.degradeEquipment,
});
const consumableActions = useConsumableActions({ /* ~6 params */ });
```

Existing refs (`rollLootRef`, `degradeEquipmentRef`, etc.) point to new hook returns. No new orchestration logic added.

---

## File 5: Barrel exports

- `src/features/combat/index.ts` — add `useCombatActions`
- `src/features/world/index.ts` — add `useMovementActions`
- `src/features/inventory/index.ts` — add `useConsumableActions`

---

## File 6: Delete `src/hooks/useActions.ts`

---

## Helper extraction summary

| Helper | Location | Lines saved | Benefit |
|--------|----------|-------------|---------|
| `buildLevelUpUpdates` | combat actions | ~70 | Isolates dense stat recalc, testable |
| `awardPartyXpGold` | combat actions | ~25 | Removes party loop from main flow |
| `awardPartySalvage` | combat actions | ~30 | Removes second party loop |
| `resolveOpportunityAttacks` | movement actions | ~60 | Most complex flee logic, testable |
| `moveFollowers` | movement actions | ~15×3 | Deduplicates 3 identical blocks |
| `resolveCreatureTarget` | combat actions | ~7 | Pure, no closure dependency |
| `getQueueFlavour` | combat actions | ~14 | Already pure, just moved |

---

## Constraints

- Zero gameplay/formula/timing changes
- All action behavior preserved exactly
- Build + typecheck + tests must pass
- No over-abstraction — helpers only where they reduce inline complexity

