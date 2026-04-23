

## Reward Flow Audit + Party XP Bonus Extraction

### Current Reward Flow (Audit Summary)

All reward logic lives inside `handleCreatureKill` (lines 371-457 of `combat-tick/index.ts`):

1. **Base XP**: `Math.floor(creature.level * 10 * XP_RARITY_MULTIPLIER)` (line 384)
2. **Gold**: Rolled from creature `loot_table` gold entry, CHA multiplier applied for humanoids (lines 386-393)
3. **Level penalty**: `xpPenalty(memberLevel, creatureLevel)` per member (line 400)
4. **XP boost**: Global `xpMult` from `xp_boost` table (line 401)
5. **XP split**: Divided by number of uncapped (< L42) members (line 401)
6. **Gold split**: Divided equally among all members (lines 394-403)
7. **BHP**: Boss kills award `floor(level * 0.5)` split evenly (lines 420-431)
8. **Salvage**: Non-humanoid kills award `(1 + floor(level/5)) * rarityMult` split evenly (lines 432-441)
9. **Loot queuing**: Pushed to `lootQueue` for later DB processing (lines 442-456)
10. **DB writes**: Accumulated in `mXp`/`mGold`/`mBhp`/`mSalvage`, written in member update loop (lines 986-1054)
11. **Level-up**: Checked inline after reward accumulation (lines 1001-1043)
12. **Notifications**: Kill event messages pushed to `events` array, returned in response (lines 405-419)

### Plan

#### 1. Create `supabase/functions/_shared/reward-calculator.ts`

A pure helper that owns reward math only. No DB access, no event formatting.

```typescript
interface RewardMember {
  id: string;
  level: number;
  cha: number;        // effective CHA (base + gear)
  isUncapped: boolean; // level < 42
}

interface CreatureRewardInput {
  level: number;
  rarity: string;
  isHumanoid: boolean;
  isBoss: boolean;
  lootTable: any[];    // for gold entry lookup
  xpBoostMultiplier: number;
  partySize: number;   // eligible members at node
}

interface MemberReward {
  memberId: string;
  xp: number;
  gold: number;
  bhp: number;
  salvage: number;
  xpPenaltyApplied: number;  // 0-1 multiplier for display
  partyBonusApplied: number; // 1.0-1.4 multiplier for display
}

interface RewardResult {
  memberRewards: MemberReward[];
  totalGoldRolled: number;
  baseXp: number;
}
```

**Calculation order** (matches current flow, party bonus inserted after penalty):
1. Compute `baseXp = floor(level * 10 * rarityMult)`
2. Roll gold from loot table gold entry
3. Apply CHA gold multiplier (humanoids only, using highest CHA among members)
4. For each uncapped member: apply level penalty → apply XP boost → apply party size bonus → split by uncapped count
5. Split gold evenly among all members
6. Compute BHP (boss only): `floor(level * 0.5 / partySize)`
7. Compute salvage (non-humanoid): `floor((1 + floor(level/5)) * rarityMult / partySize)`

**Party XP bonus** (new):
```typescript
const PARTY_XP_BONUS: Record<number, number> = { 1: 1.0, 2: 1.15, 3: 1.30, 4: 1.40 };
function getPartyXpBonus(memberCount: number): number {
  return PARTY_XP_BONUS[Math.min(memberCount, 4)] ?? 1.0;
}
```

Applied per-member after level penalty and XP boost, before split:
```
finalXp = floor(floor(baseXp * penalty * xpBoost * partyBonus) / xpSplit)
```

#### 2. Refactor `combat-tick/index.ts` — `handleCreatureKill`

Replace the inline reward math (lines 384-441) with a call to the new helper:

```typescript
import { calculateCreatureRewards } from "../_shared/reward-calculator.ts";

const handleCreatureKill = (creature, killerLabel, chaForGold) => {
  // ... existing kill bookkeeping (cKilled, effect cleanup, etc.) stays
  
  const rewardMembers = members.map(mm => ({
    id: mm.id,
    level: mm.c.level,
    cha: (mm.c.cha || 10) + (eq[mm.id]?.cha || 0),
    isUncapped: mm.c.level < 42,
  }));
  
  const result = calculateCreatureRewards({
    level: creature.level,
    rarity: creature.rarity,
    isHumanoid: creature.is_humanoid,
    isBoss: creature.rarity === 'boss',
    lootTable: creature.loot_table || [],
    xpBoostMultiplier: xpMult,
    partySize: members.length,
  }, rewardMembers);
  
  // Accumulate rewards (same as current)
  for (const mr of result.memberRewards) {
    mXp[mr.memberId] += mr.xp;
    mGold[mr.memberId] += mr.gold;
    mBhp[mr.memberId] += mr.bhp;
    mSalvage[mr.memberId] += mr.salvage;
  }
  
  // Event messages — rebuilt from structured result (same format as current)
  // ... kill message with penalty/boost/party bonus notes
  
  // Loot queuing — stays inline (unchanged)
};
```

**What stays in `handleCreatureKill`**: kill bookkeeping (cKilled, effect cleanup, killedCreatureIds), event message formatting, loot queue push logic.

**What stays in the tick loop**: level-up processing, DB writes, session management, combat flow.

#### 3. Update kill event messages

Add party bonus note to kill messages when bonus > 1.0:
```
☠️ Wolf has been slain! Rewards split 2 ways: +45 XP, +3 gold each. (🤝 +15% party bonus)
```

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/reward-calculator.ts` | **New** — pure reward math helper |
| `supabase/functions/combat-tick/index.ts` | Replace inline reward math with helper calls; add party bonus display |

### Not Changed

- Combat formulas, movement, loot drops, command system, client-side display
- Level-up processing (remains in combat-tick member update loop)
- Reward DB writes (remain in combat-tick)
- Broadcast/notification structure (same event types and format)
- `combat-catchup` (does not handle rewards)

### Final Party XP Bonus Values

| Members at node | XP Multiplier |
|----------------|---------------|
| 1 | 1.00x |
| 2 | 1.15x |
| 3 | 1.30x |
| 4+ | 1.40x |

