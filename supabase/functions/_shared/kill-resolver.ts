/**
 * kill-resolver.ts — Single source of truth for "what happens when a creature dies".
 *
 * Used by:
 *   - combat-tick     → live combat, recipients = combat_session members at the kill node
 *   - combat-catchup  → offscreen DoT reconciliation, recipients = party of the DoT source
 *                       (or just the source if soloing)
 *
 * RESPONSIBILITIES (pure / no DB):
 *   1. Compute per-recipient rewards via `calculateCreatureRewards`
 *   2. Format the canonical kill log line, BHP line, salvage line
 *   3. Compute the boss death cry text (if any)
 *   4. Build the loot-queue entries for any loot mode (item_pool / legacy_table /
 *      legacy entries / salvage_only)
 *
 * NOT responsible for:
 *   - Database writes (caller applies memberRewards / events / lootQueue)
 *   - Idempotency / claiming (caller decides whether a kill is awardable)
 *   - Broadcasts (caller handles party_combat_msg / party_reward / world)
 *
 * RECIPIENT-SET RULES (documented for both call sites):
 *   - Live combat   : recipients = members of the active combat_session at the
 *                     kill node. Solo is just `recipients.length === 1`.
 *   - Offscreen DoT : recipients = accepted party of the DoT source character
 *                     if the source is in a party (regardless of where members
 *                     are physically located); otherwise [source] only.
 *                     Rationale: DoT damage is "remote labor" by the source —
 *                     they share with their party the same way live kills do,
 *                     but solo DoT kills only pay the source.
 */

import {
  calculateCreatureRewards,
  type RewardMember,
  type MemberReward,
} from "./reward-calculator.ts";
import type { LootQueueEntry } from "./combat-resolver.ts";

export interface KillCreatureInput {
  id: string;
  name: string;
  level: number;
  rarity: string;
  is_humanoid: boolean;
  loot_table?: any[];
  loot_table_id?: string | null;
  loot_mode?: string | null;
  drop_chance?: number | null;
  boss_death_cry?: string | null;
}

export interface KillContext {
  nodeId: string;
  /** Display name of the entity credited with the killing blow ("DoT", player name, etc.). */
  killerLabel: string;
  /** XP boost multiplier currently active (≥ 1). */
  xpBoostMultiplier: number;
}

export interface KillOutcome {
  memberRewards: MemberReward[];
  /** The recipient used for log-display values (XP/gold each lines). */
  displayMemberId: string;
  /** Pre-formatted event objects ready to push into the events array. */
  events: { type: string; message: string; creature_id?: string; creature_name?: string }[];
  /** Loot-queue entries to feed into processLootDrops. */
  lootQueue: LootQueueEntry[];
  /** Boss death-cry text with %a substituted, or null if not applicable. */
  bossDeathCryText: string | null;
  /** Raw totals for diagnostics / broadcast payloads. */
  totalGoldRolled: number;
  baseXp: number;
  partyBonus: number;
}

/**
 * Resolve a creature death into rewards + events + loot. Pure function.
 *
 * Caller must:
 *   - have already determined the creature is dead and that this resolution is
 *     permitted (idempotency claim, kill dedup, etc.)
 *   - apply `memberRewards` to characters (XP/gold/salvage/BHP + level-up)
 *   - push `events` to its event stream
 *   - push `lootQueue` entries through `processLootDrops`
 *   - broadcast `bossDeathCryText` to the world channel if non-null
 */
export function resolveCreatureKill(
  creature: KillCreatureInput,
  recipients: RewardMember[],
  ctx: KillContext,
): KillOutcome {
  // ── 1. Reward math (single source of truth) ─────────────────────
  const result = calculateCreatureRewards(
    {
      level: creature.level,
      rarity: creature.rarity,
      isHumanoid: creature.is_humanoid,
      isBoss: creature.rarity === 'boss',
      lootTable: creature.loot_table || [],
      xpBoostMultiplier: ctx.xpBoostMultiplier,
      partySize: recipients.length,
    },
    recipients,
  );

  // ── 2. Pick a display recipient (first uncapped, else first) ────
  const uncapped = recipients.filter(r => r.isUncapped);
  const displayRecipient = uncapped[0] ?? recipients[0];
  const displayReward =
    result.memberRewards.find(r => r.memberId === displayRecipient.id)!;
  const allCapped = uncapped.length === 0;

  // ── 3. Compose log lines ────────────────────────────────────────
  const events: KillOutcome['events'] = [];
  const goldEach = displayReward.gold;
  const xpBoostNote = ctx.xpBoostMultiplier > 1 ? ` ⚡${ctx.xpBoostMultiplier}x` : '';
  const penaltyNote =
    displayReward.xpPenaltyApplied < 1
      ? ` (${Math.round(displayReward.xpPenaltyApplied * 100)}% XP — level penalty)`
      : '';
  const partyBonusNote =
    result.partyBonus > 1
      ? ` (🤝 +${Math.round((result.partyBonus - 1) * 100)}% party bonus)`
      : '';
  const goldNote = goldEach > 0 ? `, +${goldEach} gold` : '';
  const killerSuffix = ctx.killerLabel ? ` by ${ctx.killerLabel}` : '';

  if (allCapped) {
    const cappedGoldNote = goldEach > 0 ? ` +${goldEach} gold${recipients.length > 1 ? ' each' : ''}.` : '';
    events.push({
      type: 'creature_kill',
      message: `☠️ ${creature.name} has been slain${killerSuffix}!${cappedGoldNote} Your power transcends experience.`,
      creature_id: creature.id,
      creature_name: creature.name,
    });
  } else if (recipients.length > 1) {
    events.push({
      type: 'creature_kill',
      message: `☠️ ${creature.name} has been slain${killerSuffix}! Rewards split ${uncapped.length} ways: +${displayReward.xp} XP${goldNote} each.${penaltyNote}${xpBoostNote}${partyBonusNote}`,
      creature_id: creature.id,
      creature_name: creature.name,
    });
  } else {
    events.push({
      type: 'creature_kill',
      message: `☠️ ${creature.name} has been slain${killerSuffix}! +${displayReward.xp} XP${goldNote}.${penaltyNote}${xpBoostNote}`,
      creature_id: creature.id,
      creature_name: creature.name,
    });
  }

  if (displayReward.bhp > 0) {
    // `displayReward.bhp` is legacy storage for the Renown award value.
    events.push({
      type: 'renown_award',
      message: `🏛️ +${displayReward.bhp} Renown${recipients.length > 1 ? ' each' : ''}!`,
    });
  }
  if (displayReward.salvage > 0) {
    events.push({
      type: 'salvage',
      message: `🔩 +${displayReward.salvage} salvage${recipients.length > 1 ? ' each' : ''} from ${creature.name}.`,
    });
  }

  // ── 4. Boss death cry ───────────────────────────────────────────
  let bossDeathCryText: string | null = null;
  if (
    creature.rarity === 'boss' &&
    typeof creature.boss_death_cry === 'string' &&
    creature.boss_death_cry.trim().length > 0
  ) {
    bossDeathCryText = creature.boss_death_cry
      .trim()
      .replace(/%a/g, ctx.killerLabel || 'a hero');
  }

  // ── 5. Loot queue (honors all loot modes) ───────────────────────
  const lootQueue: LootQueueEntry[] = [];
  const lootMode = creature.loot_mode || 'legacy_table';
  const lootTableEntries = (creature.loot_table || []) as any[];
  const dropChance = creature.drop_chance ?? 0.5;

  if (lootMode === 'item_pool') {
    lootQueue.push({
      nodeId: ctx.nodeId,
      lootTableId: null,
      itemId: null,
      creatureName: creature.name,
      dropChance,
      mode: 'item_pool',
      creatureLevel: creature.level,
    });
  } else if (lootMode === 'salvage_only') {
    // Intentionally no item loot — salvage-only creatures only grant the
    // salvage reward computed above.
  } else if (creature.loot_table_id) {
    lootQueue.push({
      nodeId: ctx.nodeId,
      lootTableId: creature.loot_table_id,
      itemId: null,
      creatureName: creature.name,
      dropChance,
      mode: 'legacy',
    });
  } else {
    for (const entry of lootTableEntries) {
      if (entry.type === 'gold') continue;
      if (Math.random() <= (entry.chance || 0.1)) {
        lootQueue.push({
          nodeId: ctx.nodeId,
          lootTableId: null,
          itemId: entry.item_id,
          creatureName: creature.name,
          dropChance: 1,
          mode: 'legacy',
        });
      }
    }
  }

  return {
    memberRewards: result.memberRewards,
    displayMemberId: displayRecipient.id,
    events,
    lootQueue,
    bossDeathCryText,
    totalGoldRolled: result.totalGoldRolled,
    baseXp: result.baseXp,
    partyBonus: result.partyBonus,
  };
}
