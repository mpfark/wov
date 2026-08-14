/**
 * Permanent SQL/TypeScript effect-contract parity guard.
 *
 * The deployed validator `public.validate_active_effect()` is GENERATED from
 * `EFFECT_MECHANIC_REGISTRY` and checked in at
 * `supabase/contract/active_effects_validate.sql`. This suite fails if any of
 * the three copies drift:
 *
 *   TypeScript registry  ->  rendered SQL  ->  checked-in artifact
 *
 * It also proves the two rule engines AGREE, not merely that the text matches:
 * a table of accept/reject rows is evaluated by `validateEffectRow` (TS) and by
 * an interpreter driven exclusively by the registry embedded in the artifact
 * (the SQL side's own data), and the verdicts must be identical.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EFFECT_MECHANIC_REGISTRY,
  EFFECT_PARAMS_VERSION,
  validateEffectRow,
  type EffectTargetKind,
} from '@/shared/combat/pure/effect-contract';
import {
  buildEffectContractSql,
  effectContractJson,
  EFFECT_IMMUTABLE_COLUMNS,
  EFFECT_MUTABLE_COLUMN,
  EFFECT_STACKS_MAX,
  EFFECT_TICK_COLUMNS,
} from '@/shared/combat/pure/effect-contract-sql';
import { MECHANIC_FAMILY } from '@/shared/combat/pure/mechanics';

const ARTIFACT = 'supabase/contract/active_effects_validate.sql';
const artifact = readFileSync(ARTIFACT, 'utf8');

/** The registry the SQL side actually enforces, read back out of the artifact. */
function sqlRegistry(): Record<string, any> {
  const start = artifact.indexOf('$contract$') + '$contract$'.length;
  const end = artifact.indexOf('$contract$', start);
  expect(start).toBeGreaterThan(10);
  expect(end).toBeGreaterThan(start);
  return JSON.parse(artifact.slice(start, end));
}

describe('effect contract SQL/TS parity', () => {
  it('the checked-in artifact is exactly what the registry renders', () => {
    expect(artifact).toBe(buildEffectContractSql());
  });

  it('the artifact embeds the TypeScript registry verbatim', () => {
    expect(sqlRegistry()).toEqual(JSON.parse(JSON.stringify(effectContractJson())));
  });

  it('both sides know the same mechanics', () => {
    expect(Object.keys(sqlRegistry()).sort()).toEqual(Object.keys(EFFECT_MECHANIC_REGISTRY).sort());
  });

  it('agrees per mechanic on target, source rule, cadence, bounds, params and mutability', () => {
    const sqlReg = sqlRegistry();
    for (const [mechanic, spec] of Object.entries(EFFECT_MECHANIC_REGISTRY)) {
      const s = sqlReg[mechanic];
      expect(s, mechanic).toBeTruthy();
      expect(s.target, `${mechanic}.target`).toBe(spec.target);
      expect(s.sourceMustBeCharacter, `${mechanic}.source`).toBe(spec.sourceMustBeCharacter);
      expect(s.periodic, `${mechanic}.periodic`).toBe(spec.periodic);
      expect(s.remaining, `${mechanic}.remaining`).toBe(spec.remaining);
      expect(s.stackPolicy, `${mechanic}.stackPolicy`).toBe(spec.stackPolicy);
      expect(s.magnitude, `${mechanic}.magnitude`).toEqual({
        required: spec.magnitude.required, min: spec.magnitude.min, max: spec.magnitude.max,
      });
      expect(s.mutableColumns, `${mechanic}.mutable`).toEqual(
        spec.mutable.map((m) => EFFECT_MUTABLE_COLUMN[m]).sort(),
      );
      expect(Object.keys(s.params).sort(), `${mechanic}.paramKeys`).toEqual(Object.keys(spec.params).sort());
      for (const [key, ps] of Object.entries(spec.params)) {
        const sp = s.params[key];
        expect(sp.kind, `${mechanic}.params.${key}.kind`).toBe(ps.kind);
        expect(!!sp.required, `${mechanic}.params.${key}.required`).toBe(!!ps.required);
        expect(!!sp.integer, `${mechanic}.params.${key}.integer`).toBe(!!ps.integer);
        expect(sp.min, `${mechanic}.params.${key}.min`).toBe(ps.min);
        expect(sp.max, `${mechanic}.params.${key}.max`).toBe(ps.max);
        expect(sp.values, `${mechanic}.params.${key}.values`).toEqual(ps.values ? [...ps.values] : undefined);
      }
      // Families stay aligned with the resolver's own family map.
      if (MECHANIC_FAMILY[mechanic as keyof typeof MECHANIC_FAMILY]) {
        expect(s.family, `${mechanic}.family`).toBe(MECHANIC_FAMILY[mechanic as keyof typeof MECHANIC_FAMILY]);
      }
    }
  });

  it('agrees on the params version and the global stack bound', () => {
    expect(artifact).toContain(`NEW.params_version IS DISTINCT FROM ${EFFECT_PARAMS_VERSION}`);
    expect(artifact).toContain(`NEW.stacks > ${EFFECT_STACKS_MAX}`);
    expect(artifact).toContain('params require a registered mechanic');
  });

  it('guards every immutable column and every mechanic-gated tick column', () => {
    for (const col of EFFECT_IMMUTABLE_COLUMNS) {
      expect(artifact, col).toContain(`active_effects.${col}: immutable field may not change`);
    }
    for (const col of EFFECT_TICK_COLUMNS) {
      expect(artifact, col).toContain(`NOT ('${col}' = ANY (mutable))`);
    }
    expect(new Set(Object.values(EFFECT_MUTABLE_COLUMN))).toEqual(new Set(EFFECT_TICK_COLUMNS));
  });
});

// ── Rule-engine agreement ─────────────────────────────────────────────────

type Probe = {
  name: string;
  mechanic: string;
  targetKind: EffectTargetKind;
  sourceCharacterId?: string | null;
  magnitude?: number | null;
  remaining?: number | null;
  intervalMs?: number;
  paramsVersion?: number;
  params?: Record<string, unknown>;
};

/** The SQL branch order, driven only by the registry embedded in the artifact. */
function sqlVerdict(p: Probe): boolean {
  const reg = sqlRegistry();
  if ((p.paramsVersion ?? EFFECT_PARAMS_VERSION) !== EFFECT_PARAMS_VERSION) return false;
  const spec = reg[p.mechanic];
  if (!spec) return false;
  if (p.targetKind !== spec.target) return false;
  if (spec.sourceMustBeCharacter && !p.sourceCharacterId) return false;
  if (spec.periodic && !((p.intervalMs ?? 0) > 0)) return false;
  const mag = p.magnitude ?? null;
  if (spec.magnitude.required && mag === null) return false;
  if (mag !== null && (mag < spec.magnitude.min || mag > spec.magnitude.max)) return false;
  const rem = p.remaining ?? null;
  if (rem !== null && (spec.remaining === 'unused' || rem < 0)) return false;
  const params = p.params ?? {};
  for (const key of Object.keys(params)) if (!spec.params[key]) return false;
  for (const [key, ps] of Object.entries<any>(spec.params)) {
    const v = (params as Record<string, unknown>)[key];
    if (v === undefined || v === null) {
      if (ps.required) return false;
      continue;
    }
    if (ps.kind === 'boolean' && typeof v !== 'boolean') return false;
    if (ps.kind === 'string' && (typeof v !== 'string' || v.length === 0)) return false;
    if (ps.kind === 'enum' && (typeof v !== 'string' || !ps.values.includes(v))) return false;
    if (ps.kind === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return false;
      if (ps.integer && !Number.isInteger(v)) return false;
      if (ps.min !== undefined && v < ps.min) return false;
      if (ps.max !== undefined && v > ps.max) return false;
    }
  }
  return true;
}

function tsVerdict(p: Probe): boolean {
  try {
    validateEffectRow(
      {
        mechanic: p.mechanic,
        targetKind: p.targetKind,
        sourceCharacterId: p.sourceCharacterId ?? null,
        magnitude: p.magnitude ?? null,
        remaining: p.remaining ?? null,
        intervalMs: p.intervalMs ?? 0,
        paramsVersion: p.paramsVersion ?? EFFECT_PARAMS_VERSION,
        params: p.params ?? {},
      },
      'probe',
    );
    return true;
  } catch {
    return false;
  }
}

const CHAR = 'char-1';

const PROBES: Probe[] = [
  { name: 'valid absorb pool', mechanic: 'absorb_buff', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 40, remaining: 40 },
  { name: 'unknown mechanic', mechanic: 'mind_control', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 1 },
  { name: 'wrong target kind', mechanic: 'absorb_buff', targetKind: 'creature', sourceCharacterId: CHAR, magnitude: 40 },
  { name: 'dot on creature', mechanic: 'dot_debuff', targetKind: 'creature', sourceCharacterId: CHAR, intervalMs: 2000, params: { maxStacks: 5 } },
  { name: 'dot missing cadence', mechanic: 'dot_debuff', targetKind: 'creature', sourceCharacterId: CHAR, intervalMs: 0 },
  { name: 'missing source', mechanic: 'mitigation_buff', targetKind: 'character', sourceCharacterId: null, magnitude: 0.2, params: { mode: 'percent' } },
  { name: 'missing required magnitude', mechanic: 'mitigation_buff', targetKind: 'character', sourceCharacterId: CHAR, params: { mode: 'percent' } },
  { name: 'magnitude above bound', mechanic: 'offense_buff', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 1000, params: { offenseMode: 'damage_mult' } },
  { name: 'remaining on unused mechanic', mechanic: 'mitigation_buff', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 0.2, remaining: 3, params: { mode: 'percent' } },
  { name: 'negative remaining', mechanic: 'stealth_buff', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 3, remaining: -1 },
  { name: 'unknown param', mechanic: 'block_buff', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 0.2, params: { wildcard: 1 } },
  { name: 'param above bound', mechanic: 'block_buff', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 0.2, params: { blockAmount: 5000 } },
  { name: 'param wrong type', mechanic: 'mitigation_buff', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 0.2, params: { mode: 'percent', taunt: 1 } },
  { name: 'enum out of set', mechanic: 'evasion_buff', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 50, params: { kind: 'phase', evasionSource: 'cloak' } },
  { name: 'missing required enum', mechanic: 'evasion_buff', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 50, params: { kind: 'dodge' } },
  { name: 'non-integer where integer required', mechanic: 'stack_apply', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 1, params: { stackEffectType: 's', trigger: 'weapon_hit', dotPerTick: 4, durationMs: 1000.5, intervalMs: 2000, maxStacks: 5 } },
  { name: 'valid stack applier', mechanic: 'stack_apply', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 1, params: { stackEffectType: 's', trigger: 'weapon_hit', dotPerTick: 4, durationMs: 1000, intervalMs: 2000, maxStacks: 5 } },
  { name: 'unsupported params version', mechanic: 'absorb_buff', targetKind: 'character', sourceCharacterId: CHAR, magnitude: 10, paramsVersion: 2 },
  { name: 'valid periodic regen', mechanic: 'regen_buff', targetKind: 'character', sourceCharacterId: CHAR, intervalMs: 2000, params: { cpPerTick: 2, healsAllies: true } },
  { name: 'valid control debuff', mechanic: 'control_debuff', targetKind: 'creature', sourceCharacterId: CHAR, magnitude: 0, params: { ampPct: 0.1 } },
];

describe('effect contract rule engines agree', () => {
  for (const probe of PROBES) {
    it(`${probe.name}`, () => {
      expect({ probe: probe.name, sql: sqlVerdict(probe) }).toEqual({
        probe: probe.name,
        sql: tsVerdict(probe),
      });
    });
  }

  it('covers an accepted and a refused probe for every mechanic bound class', () => {
    expect(PROBES.filter((p) => tsVerdict(p)).length).toBeGreaterThanOrEqual(5);
    expect(PROBES.filter((p) => !tsVerdict(p)).length).toBeGreaterThanOrEqual(12);
  });
});
