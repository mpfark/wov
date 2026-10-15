// ISOLATED DESIGN PROOF. No runtime imports, IO, clock, database or scheduler.
// Assumes every eligibility transition is supplied at its authoritative cutoff.
// Rational credit and proposed edit/blocker policies are not production schema.
const gcd = (a, b) => b === 0n ? a : gcd(b, a % b);
export function fraction(n, d = 1n) {
  if (n < 0n || d <= 0n) throw Error('invalid fraction');
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const add = (a, b) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
export const DEFAULT_RATE = '5';
export const DELAY_MS = 60_000n;

// Exact finite decimal string; no binary float, exponent or silent rounding.
// Proof permits arbitrary decimal precision; production precision is not chosen.
export function parseRate(text) {
  if (typeof text !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(text)) {
    throw Error('decimal string required');
  }
  const [whole, decimals = ''] = text.split('.');
  const rate = fraction(BigInt(whole + decimals), 10n ** BigInt(decimals.length));
  if (rate.n > 100n * rate.d) throw Error('rate outside 0–100');
  return rate;
}

const matching = (s, f) => f.projection?.creature_id === s.id
  && f.projection.spawn_seq === s.generation;
export const activeAttachment = (s, f) => matching(s, f) && f.encounterStatus === 'active';

// Proposed conservative adapter of source-shaped observations. Caller must
// supply only pending intents/unconsumed events and canonically unresolved effects.
// Wall-clock expiry is deliberately not evaluated here (sleep is not resolution).
export function blockers(s, f) {
  const reasons = [];
  if (f.uncertain) reasons.push('requires_evidence');
  const current = matching(s, f);
  const livingPresent = f.fighters.some(x => x.present && x.hp > 0);
  if (current && f.encounterStatus === 'active' && f.projection.engaged && livingPresent) {
    reasons.push('engaged_with_present_fighters');
  }
  if (current && f.projection.pending_action !== null) reasons.push('pending_creature_action');
  for (const effect of f.effects) {
    const cfg = effect.config ?? {};
    const direct = effect.target_creature_id === s.id;
    const fenced = cfg.node_creature_id !== undefined || cfg.spawn_seq !== undefined;
    const targetMatches = direct && (!fenced || (current
      && cfg.node_creature_id === f.projection.id && cfg.spawn_seq === s.generation));
    // Aura pulses affect all living creatures, including previously unengaged ones.
    const aura = effect.kind === 'aura' && f.fighters.some(x => x.present && x.hp > 0
      && x.character_id === effect.source_character_id
      && x.id === cfg.source_fighter_id && x.entry_seq === cfg.source_entry_seq);
    if (targetMatches || effect.source_creature_id === s.id || aura) reasons.push('unresolved_effect');
    // Other unresolved non-passive effects with live fighters are conservative
    // encounter-wide blockers until exact mechanic applicability is established.
    else if (current && livingPresent && !effect.is_reservation && cfg.persistent_stance !== true
      && !['autoattack', 'stack_source'].includes(effect.kind)) reasons.push('effect_scope_uncertain');
  }
  if (current && f.pendingIntents.length) reasons.push('pending_intent');
  if (current && f.pendingEvents.length) reasons.push('pending_event');
  return [...new Set(reasons)];
}

function time(s, at) {
  if (typeof at !== 'bigint' || at < s.through) throw Error('nonmonotonic time');
}
export function initialize({ id = 'fixture', hp, maxHp, generation = 1n, alive = true,
  at = 0n, rate = DEFAULT_RATE, blocked = false }) {
  if (at < 0n || generation < 1n || maxHp <= 0n || hp < 0n || hp > maxHp
    || (alive && hp === 0n) || (!alive && hp !== 0n)) throw Error('invalid creature');
  return { id, hp, projectionHp: hp, maxHp, generation, alive, rate: parseRate(rate),
    credit: fraction(0n), eligibleSince: alive && !blocked ? at : null,
    blocked, through: at, version: 0n };
}

export function settle(s, at, { liveClaim = false, expectedVersion = s.version } = {}) {
  time(s, at);
  if (expectedVersion !== s.version) throw Error('stale accounting observation');
  if (s.hp !== s.projectionHp) throw Error('projection mismatch requires evidence');
  if (liveClaim || at === s.through) return s;
  let hp = s.hp;
  let credit = s.credit;
  if (!s.alive || hp === s.maxHp) credit = fraction(0n);
  else if (!s.blocked && s.eligibleSince !== null && s.rate.n > 0n) {
    const start = s.through > s.eligibleSince + DELAY_MS ? s.through : s.eligibleSince + DELAY_MS;
    if (at > start) {
      const earned = fraction(s.maxHp * s.rate.n * (at - start), s.rate.d * 100n * 60_000n);
      const total = add(credit, earned);
      hp = s.hp + total.n / total.d;
      credit = fraction(total.n % total.d, total.d);
      if (hp >= s.maxHp) { hp = s.maxHp; credit = fraction(0n); }
    }
  }
  return { ...s, hp, projectionHp: hp, credit, through: at, version: s.version + 1n };
}

// Proposed: settle the proved previous interval, then close/open eligibility.
// Preserve already earned fractional HP across interruptions; no blocked-time
// credit. Whether combat should discard that fraction remains an owner decision.
export function transition(s, at, blocked) {
  const next = settle(s, at);
  if (blocked === s.blocked) return next;
  return { ...next, blocked, eligibleSince: blocked || !s.alive ? null : at,
    version: next.version + 1n };
}

export function editRate(s, at, text, facts) {
  const rate = parseRate(text);
  if (facts.uncertain || activeAttachment(s, facts)) throw Error('rate edit attachment refused');
  // Proposed edit policy: old rate through cutoff, exact accrued fraction retained;
  // zero earns nothing, but does not erase prior earned credit or quiet history.
  const next = settle(s, at);
  return { ...next, rate, version: next.version + 1n };
}

export const captureClaim = s => ({ generation: s.generation, version: s.version });
export function applyCombatResult(s, claim, hp, at) {
  time(s, at);
  if (claim.generation !== s.generation || claim.version !== s.version) throw Error('stale claim');
  if (hp < 0n || hp > s.maxHp || !s.alive) throw Error('invalid combat result');
  return { ...s, hp, projectionHp: hp, alive: hp > 0n, blocked: true,
    eligibleSince: null, through: at, credit: hp === 0n ? fraction(0n) : s.credit,
    version: s.version + 1n };
}

// Receives an ALREADY APPROVED ordinary respawn result. Does not decide when,
// award rewards, perform respawn or simulate elapsed dead time.
export function observeOrdinaryRespawn(s, at, generation) {
  time(s, at);
  if (s.alive || generation !== s.generation + 1n) throw Error('ordinary respawn required');
  return { ...s, hp: s.maxHp, projectionHp: s.maxHp, generation, alive: true,
    blocked: false, eligibleSince: at, through: at, credit: fraction(0n), version: s.version + 1n };
}
