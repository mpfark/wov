/**
 * reward-calculator.ts — Pure reward math for creature kills.
 *
 * Calculation order:
 *   1. Base XP  = floor(creatureLevel * 10 * rarityMultiplier)
 *   2. Gold     = roll from loot table gold entry, CHA multiplier for humanoids
 *   3. Per-member XP = floor(floor(baseXp * levelPenalty * xpBoost * partyBonus) / uncappedSplit)
 *   4. Gold split evenly among all members
 *   5. BHP      = floor(creatureLevel * 0.5) / partySize  (boss only)
 *   6. Salvage  = (1 + floor(level/5)) * rarityMult / partySize  (non-humanoid only)
 *
 * This file has NO database access and NO event formatting.
 */

// XP penalty: party reward distribution uses the harsher curve
// (matches the historic value previously inlined in `combat-math.ts`).
import { getXpPenalty as xpPenalty } from "./formulas/xp.ts";
import { getChaGoldMultiplier as chaGoldMult } from "./formulas/economy.ts";
import { XP_RARITY_MULTIPLIER as XP_RARITY } from "./formulas/xp.ts";

// ── Party XP bonus table ───────────────────────────────────────
const PARTY_XP_BONUS: Record<number, number> = {
  1: 1.0,
  2: 1.15,
  3: 1.30,
  4: 1.40,
};

export function getPartyXpBonus(memberCount: number): number {
  return PARTY_XP_BONUS[Math.min(memberCount, 4)] ?? 1.0;
}

// ── Types ──────────────────────────────────────────────────────

export interface RewardMember {
  id: string;
  level: number;
  cha: number;         // effective CHA (base + gear)
  isUncapped: boolean; // level < 42
}

export interface CreatureRewardInput {
  level: number;
  rarity: string;
  isHumanoid: boolean;
  isBoss: boolean;
  lootTable: any[];          // creature.loot_table jsonb array
  xpBoostMultiplier: number; // global xpMult (≥ 1)
  partySize: number;         // total eligible members at node
}

export interface MemberReward {
  memberId: string;
  xp: number;
  gold: number;
  bhp: number;
  salvage: number;
  /** The level-penalty multiplier applied to this member's XP (0–1). */
  xpPenaltyApplied: number;
  /** The party-size bonus multiplier applied (1.0–1.4). */
  partyBonusApplied: number;
}

export interface RewardResult {
  memberRewards: MemberReward[];
  /** Total gold rolled before splitting. */
  totalGoldRolled: number;
  /** Base XP before any modifiers. */
  baseXp: number;
  /** Party XP bonus multiplier used. */
  partyBonus: number;
}

// ── Salvage rarity multipliers ─────────────────────────────────
const SALVAGE_RARITY: Record<string, number> = {
  boss: 4,
  rare: 2,
  regular: 1,
};

// ── Main calculation ───────────────────────────────────────────

export function calculateCreatureRewards(
  input: CreatureRewardInput,
  members: RewardMember[],
): RewardResult {
  const { level, rarity, isHumanoid, isBoss, lootTable, xpBoostMultiplier, partySize } = input;

  // 1. Base XP
  const baseXp = Math.floor(level * 10 * (XP_RARITY[rarity] || 1));

  // 2. Gold roll
  const lt = lootTable || [];
  const goldEntry = lt.find((e: any) => e.type === "gold");
  let totalGoldRolled = 0;
  if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
    totalGoldRolled = Math.floor(
      goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1),
    );
    // CHA multiplier — use highest effective CHA among members
    if (isHumanoid) {
      const bestCha = Math.max(...members.map((m) => m.cha), 0);
      if (bestCha > 0) {
        totalGoldRolled = Math.floor(totalGoldRolled * chaGoldMult(bestCha));
      }
    }
  }

  // 3. Party XP bonus
  const partyBonus = getPartyXpBonus(partySize);

  // 4. Per-member rewards
  const uncappedCount = members.filter((m) => m.isUncapped).length || 1;
  const goldEach = Math.floor(totalGoldRolled / members.length);

  // Renown (RP) — boss is the main source, rare gives a small but meaningful taste.
  // NOTE: the `bhp` field name on MemberReward is legacy storage for Renown.
  //   rare:   max(1, floor(level * 0.10))
  //   boss:   floor(level * 0.50)
  //   others: 0
  const rpTotal = isBoss
    ? Math.floor(level * 0.5)
    : (rarity === 'rare' ? Math.max(1, Math.floor(level * 0.10)) : 0);
  const rpEach = rpTotal > 0 ? Math.max(1, Math.floor(rpTotal / partySize)) : 0;

  // Salvage (non-humanoid only)
  const salvageRarityMult = SALVAGE_RARITY[rarity] || 1;
  const totalSalvage = !isHumanoid ? (1 + Math.floor(level / 5)) * salvageRarityMult : 0;
  const salvageEach = totalSalvage > 0 ? Math.floor(totalSalvage / partySize) : 0;

  const memberRewards: MemberReward[] = members.map((mm) => {
    const penalty = xpPenalty(mm.level, level);
    const xp = mm.isUncapped
      ? Math.floor(Math.floor(baseXp * penalty * xpBoostMultiplier * partyBonus) / uncappedCount)
      : 0;

    return {
      memberId: mm.id,
      xp,
      gold: goldEach,
      // `bhp` is legacy storage for current Renown balance reward.
      bhp: rpEach,
      salvage: salvageEach,
      xpPenaltyApplied: penalty,
      partyBonusApplied: partyBonus,
    };
  });

  return { memberRewards, totalGoldRolled, baseXp, partyBonus };
}
