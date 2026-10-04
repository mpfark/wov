/** Future authority contracts only. No current RPC, browser or worker imports this module.
 * Intended rules are owned by docs/design/game-engine.md, Progression and rewards.
 * Database locking, authorization, replay and persistence are NOT implemented here.
 */
export const PROGRESSION_CONTRACT_VERSION = 1 as const;
export const PROGRESSION_RULES_VERSION = 1 as const;
export const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type StatKey = typeof STAT_KEYS[number];
export type StatValues = Readonly<{ [K in StatKey]: number }>;
export type StatDeltas = Readonly<Partial<{ [K in StatKey]: number }>>;
export type RespecMilestoneLevel = 10 | 20 | 30 | 40;

/** Stable domain identity, never a fresh UUID generated for each retry. */
export type XpEventIdentity =
  | { readonly source: 'combat2_reward'; readonly characterId: string; readonly rewardClaimId: string }
  | { readonly source: 'craft_completion'; readonly characterId: string; readonly completionId: string }
  | { readonly source: 'admin_xp'; readonly characterId: string; readonly requestId: string; readonly actorId: string; readonly reason: string };
export interface XpAwardContract {
  readonly contractVersion: typeof PROGRESSION_CONTRACT_VERSION;
  readonly rulesVersion: typeof PROGRESSION_RULES_VERSION;
  readonly identity: XpEventIdentity;
  readonly offeredXp: number;
}
export interface CapturedClassGrowth {
  readonly classKey: string;
  readonly isClassless: boolean;
  readonly configRevision: string;
  readonly levelBonuses: StatDeltas;
}
export interface LevelXpState { readonly level: number; readonly xp: number }
export interface LevelTransition {
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly thresholdPaid: number;
  readonly discretionaryPoints: 1;
  readonly classGrowth: StatDeltas;
  readonly respecMilestone: RespecMilestoneLevel | null;
}
export interface XpTransition {
  readonly contractVersion: typeof PROGRESSION_CONTRACT_VERSION;
  readonly rulesVersion: typeof PROGRESSION_RULES_VERSION;
  readonly before: LevelXpState;
  readonly after: LevelXpState;
  readonly offeredXp: number;
  readonly appliedXp: number;
  readonly discardedXp: number;
  readonly thresholdsPaid: number;
  readonly nextThreshold: number | null;
  readonly discretionaryPointsGranted: number;
  readonly permanentStatDeltas: StatDeltas;
  readonly capturedClass: CapturedClassGrowth;
  readonly crossedLevels: readonly LevelTransition[];
  readonly respecMilestonesGranted: readonly RespecMilestoneLevel[];
}
export type ReferenceResult =
  | { readonly kind: 'calculated'; readonly transition: XpTransition }
  | { readonly kind: 'refused'; readonly reason: 'invalid_award' | 'arithmetic_overflow' | 'invalid_class_config' | 'invalid_milestone_history' }
  | { readonly kind: 'reconciliation_required'; readonly reason: 'invalid_level' | 'invalid_xp' | 'xp_backlog' | 'cap_xp_nonzero' };

export interface ResourceProjection {
  readonly maxHp: number; readonly hp: number;
  readonly maxCp: number; readonly cp: number;
  readonly maxMp: number; readonly mp: number;
  readonly effectiveAc: number;
}
export interface AuthoritativeCharacterProjection {
  readonly characterId: string;
  readonly progressionVersion: number;
  readonly level: number; readonly xp: number;
  readonly permanentStats: StatValues;
  readonly unspentStatPoints: number; readonly respecPoints: number;
  readonly resources: ResourceProjection;
}
export interface RespecMilestoneReceipt {
  readonly kind: 'respec_token';
  readonly level: RespecMilestoneLevel;
  readonly receiptId: string;
}
/** A committed historical result; replay is not a fresh character projection. */
export interface XpCommitReceipt {
  readonly identity: XpEventIdentity;
  readonly transition: XpTransition;
  readonly milestoneReceipts: readonly RespecMilestoneReceipt[];
  readonly versionBefore: number;
  readonly after: AuthoritativeCharacterProjection;
}
export type XpAuthorityResult =
  | { readonly kind: 'committed'; readonly receipt: XpCommitReceipt }
  | { readonly kind: 'replayed'; readonly original: XpCommitReceipt }
  | { readonly kind: 'refused'; readonly reason: 'unauthorized' | 'ineligible_source' | 'request_conflict' | 'stale_version' | 'invalid_award' | 'arithmetic_overflow' | 'invalid_class_config' | 'invalid_milestone_history' }
  | { readonly kind: 'reconciliation_required'; readonly reason: 'invalid_level' | 'invalid_xp' | 'xp_backlog' | 'cap_xp_nonzero' };

/** Source is validated internally; never a public arbitrary-delta input. */
export type PermanentMutation =
  | { readonly source: 'creation_baseline'; readonly raceKey: string; readonly configRevision: string; readonly values: StatValues }
  | { readonly source: 'class_level_growth'; readonly destinationLevel: number; readonly capturedClass: CapturedClassGrowth; readonly deltas: StatDeltas }
  | { readonly source: 'discretionary_allocation'; readonly allocations: StatDeltas }
  | { readonly source: 'discretionary_refund'; readonly investment: StatValues }
  | { readonly source: 'renown'; readonly stat: StatKey; readonly rankBefore: number; readonly rankAfter: number; readonly delta: 1 }
  | { readonly source: 'admin_override'; readonly actorId: string; readonly reason: string; readonly desired: StatValues }
  | { readonly source: 'permanent_reward'; readonly rewardId: string; readonly deltas: StatDeltas };
export interface PermanentMutationContract {
  readonly contractVersion: typeof PROGRESSION_CONTRACT_VERSION;
  readonly rulesVersion: typeof PROGRESSION_RULES_VERSION;
  readonly characterId: string;
  readonly eventId: string;
  readonly expectedProgressionVersion: number;
  readonly mutation: PermanentMutation;
}
export interface PermanentMutationReceipt {
  readonly request: PermanentMutationContract;
  readonly versionBefore: number;
  readonly permanentDeltas: StatDeltas;
  readonly refundableInvestmentAfter: StatValues;
  readonly after: AuthoritativeCharacterProjection;
}
export type PermanentMutationResult =
  | { readonly kind: 'committed'; readonly receipt: PermanentMutationReceipt }
  | { readonly kind: 'replayed'; readonly original: PermanentMutationReceipt }
  | { readonly kind: 'refused'; readonly reason: 'unauthorized' | 'invalid_delta' | 'request_conflict' | 'stale_version' | 'inconsistent_provenance' };
/** Stored at cutover without attributing any historical points to a source. */
export interface OpaqueProgressionBaseline {
  readonly characterId: string; readonly progressionVersion: number;
  readonly level: number; readonly xp: number; readonly classKey: string;
  readonly permanentStats: StatValues;
  readonly renownBalance: number; readonly trainedRanks: StatValues;
  readonly unspentStatPoints: number; readonly respecPoints: number;
}
export interface TrainerAllocationContract {
  readonly characterId: string; readonly requestId: string;
  readonly expectedProgressionVersion: number;
  readonly allocations: StatDeltas;
}
export interface RespecContract {
  readonly characterId: string; readonly requestId: string;
  readonly expectedProgressionVersion: number;
}
export type TrainerRefusal = 'unauthorized' | 'not_at_trainer' | 'active_combat' | 'unsafe_lifecycle'
  | 'invalid_allocation' | 'insufficient_points' | 'insufficient_respec_tokens'
  | 'empty_refund' | 'inconsistent_provenance' | 'request_conflict' | 'stale_version';
interface RenownTrainingReceiptBase {
  readonly requestId: string; readonly characterId: string; readonly stat: StatKey;
  readonly cost: number; readonly chancePercent: number; readonly roll: number;
  readonly rankBefore: number; readonly rankAfter: number;
  readonly renownAfter: number;
  readonly versionBefore: number; readonly after: AuthoritativeCharacterProjection;
}
export type RenownTrainingReceipt = RenownTrainingReceiptBase & (
  | { readonly success: true; readonly permanentDelta: 1 }
  | { readonly success: false; readonly permanentDelta: 0 }
);
