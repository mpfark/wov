/**
 * combat2/mitigation.ts — the single documented incoming-damage pipeline (plan §6b).
 *
 * Order, for EVERY incoming hit:
 *   1. attack roll + hit quality      (decided by the caller; untouched here)
 *   2. raw damage roll incl. crit bonus
 *   3. crit softening — reduces ONLY the critical bonus
 *   4. amplification (attacker/target side)
 *   5. percentage mitigation (`mitigation_buff` percent + authored shield bonus),
 *      clamped to the authored ceiling
 *   6. flat mitigation (Divine Challenge)
 *   7. block reduction (`block_buff`)
 *   8. absorb pool (`absorb_buff`)
 *   9. graded caps / floors
 *  10. HP resolution (caller, via `resolveDamage`)
 *
 * There is NO ability identity check anywhere in this module: every knob is an
 * authored parameter of the shared `mitigation_buff` handler, so any future
 * ability or boss ability can use it.
 */

export interface MitigationInputs {
  /** Damage excluding the critical bonus. */
  normalDamage: number;
  /** Extra damage the critical hit contributed (0 for non-crits). */
  critBonus: number;
  /** Multiplicative amplification (e.g. Chilled). 1 = none. */
  amplification?: number;
  /** Sum of authored percentage mitigation (0..1). */
  percentMitigation?: number;
  /** Authored `shield_dr_bonus`, applied only when a shield is equipped. */
  shieldDrBonus?: number;
  shieldEquipped?: boolean;
  /** Authored ceiling for total percentage mitigation (0..1). */
  mitigationCeilingPct?: number;
  /** Authored fraction of the critical bonus removed (0..1). */
  critSofteningPct?: number;
  /** Flat mitigation (Divine Challenge). */
  flatMitigation?: number;
  /** Flat block reduction (`block_buff`). */
  blockAmount?: number;
  /** Absorb pool available (`absorb_buff`). */
  absorbPool?: number;
  /** Hard cap applied after mitigation (glancing / weak bands). */
  gradedCap?: number;
  /** Floor applied after mitigation when any damage got through. */
  minimumDamage?: number;
}

export interface MitigationBreakdown {
  /** Damage after step 4, before any mitigation. */
  incoming: number;
  critSoftened: number;
  percentMitigated: number;
  shieldBonusApplied: number;
  flatMitigated: number;
  blocked: number;
  absorbed: number;
  absorbPoolAfter: number;
  /** Damage that should now be applied to HP. */
  applied: number;
}

const clamp01 = (n: number | undefined): number =>
  Number.isFinite(n) && (n as number) > 0 ? Math.min(1, n as number) : 0;

const nonNeg = (n: number | undefined): number =>
  Number.isFinite(n) && (n as number) > 0 ? (n as number) : 0;

/** Resolve one incoming hit through the documented pipeline. */
export function applyMitigationPipeline(input: MitigationInputs): MitigationBreakdown {
  const normal = nonNeg(input.normalDamage);
  const critBonus = nonNeg(input.critBonus);

  // 3. crit softening — only the critical bonus is reduced.
  const softeningPct = clamp01(input.critSofteningPct);
  const softenedBonus = critBonus * (1 - softeningPct);
  const critSoftened = Math.round(critBonus - softenedBonus);

  // 4. amplification
  const amp = Number.isFinite(input.amplification) && (input.amplification as number) > 0
    ? (input.amplification as number)
    : 1;
  const incoming = Math.max(0, Math.floor((normal + softenedBonus) * amp));

  // 5. percentage mitigation + authored shield bonus, clamped to the ceiling.
  const shieldBonus = input.shieldEquipped ? clamp01(input.shieldDrBonus) : 0;
  const ceiling = input.mitigationCeilingPct === undefined
    ? 0.75
    : clamp01(input.mitigationCeilingPct);
  const rawPct = clamp01(input.percentMitigation) + shieldBonus;
  const pct = Math.min(rawPct, ceiling);
  const percentMitigated = Math.floor(incoming * pct);
  const shieldBonusApplied = shieldBonus > 0
    ? Math.max(0, percentMitigated - Math.floor(incoming * Math.min(clamp01(input.percentMitigation), ceiling)))
    : 0;
  let running = incoming - percentMitigated;

  // 6. flat mitigation
  const flatMitigated = Math.min(running, Math.floor(nonNeg(input.flatMitigation)));
  running -= flatMitigated;

  // 7. block
  const blocked = Math.min(running, Math.floor(nonNeg(input.blockAmount)));
  running -= blocked;

  // 8. absorb pool
  const pool = Math.floor(nonNeg(input.absorbPool));
  const absorbed = Math.min(pool, running);
  running -= absorbed;

  // 9. graded caps and floors
  if (input.gradedCap !== undefined && Number.isFinite(input.gradedCap)) {
    running = Math.min(running, Math.max(0, Math.floor(input.gradedCap)));
  }
  if (running > 0 && input.minimumDamage !== undefined) {
    running = Math.max(running, Math.max(0, Math.floor(input.minimumDamage)));
  }

  return {
    incoming,
    critSoftened,
    percentMitigated,
    shieldBonusApplied,
    flatMitigated,
    blocked,
    absorbed,
    absorbPoolAfter: pool - absorbed,
    applied: Math.max(0, running),
  };
}

/**
 * Read the authored `mitigation_buff` parameters off an effect config.
 * Missing `crit_softening_pct` means "no softening applied" — never a fallback
 * percentage. The authoring gate lives in the ability-mapping batch, not here.
 */
export interface MitigationParams {
  mode: 'percent' | 'flat';
  shieldDrBonus: number;
  critSofteningPct: number | null;
  mitigationCeilingPct: number | null;
  isTaunt: boolean;
}

export function readMitigationParams(config: Record<string, unknown> | null | undefined): MitigationParams {
  const cfg = config ?? {};
  const num = (key: string): number | null => {
    const raw = cfg[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  };
  return {
    mode: cfg.mitigation_mode === 'flat' ? 'flat' : 'percent',
    shieldDrBonus: num('shield_dr_bonus') ?? 0,
    critSofteningPct: num('crit_softening_pct'),
    mitigationCeilingPct: num('mitigation_ceiling_pct'),
    isTaunt: cfg.is_taunt === true,
  };
}

/** True when the authoritative equipment snapshot shows an equipped shield. */
export function hasShieldEquipped(
  equipment: ReadonlyArray<{ slot: string }> | null | undefined,
  shieldInventoryIds: ReadonlySet<string> | null = null,
  equipmentRows: ReadonlyArray<{ slot: string; inventory_id: string }> | null = null,
): boolean {
  if (shieldInventoryIds && equipmentRows) {
    return equipmentRows.some(
      (row) => row.slot === 'off_hand' && shieldInventoryIds.has(row.inventory_id),
    );
  }
  return (equipment ?? []).some((row) => row.slot === 'off_hand');
}
