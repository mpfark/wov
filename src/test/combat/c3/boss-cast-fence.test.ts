/**
 * Telegraph participation fence — real orchestration timing order.
 *
 * The fairness policy is unchanged:
 *   - present throughout the cast            -> eligible
 *   - left and stayed away                   -> excluded
 *   - left and re-entered during that cast   -> excluded
 *   - re-entered before a NEW cast begins    -> eligible for that new cast
 *
 * What this file adds is the clock-domain case that production actually
 * produces: `encounter_intake` stamps `joined_at` with database wall-clock,
 * while the claimed tick carries a *scheduled* boundary that can be slightly
 * earlier. The boss froze that participant as its primary target during the
 * cast-start tick, so a newly started cast must never exclude its own target
 * over a difference between the two clocks.
 */
import { describe, expect, it } from 'vitest';

/**
 * The fence predicate exactly as the resolver applies it. Kept as a small pure
 * mirror so the policy is testable without constructing a whole encounter; the
 * resolver-level behaviour is covered by the parity sweeps.
 */
function eligible(
  participants: Array<{ id: string; joinedAtMs: number; alive?: boolean; present?: boolean }>,
  cast: { startedAtMs: number; targetCharacterId: string | null },
): string[] {
  return participants
    .filter(
      (p) =>
        (p.alive ?? true) &&
        (p.present ?? true) &&
        (p.joinedAtMs <= cast.startedAtMs || p.id === cast.targetCharacterId),
    )
    .map((p) => p.id);
}

const BOUNDARY = 1_700_000_000_000;

describe('telegraph participation fence', () => {
  it('includes someone present before the channel began', () => {
    expect(
      eligible([{ id: 'a', joinedAtMs: BOUNDARY - 5_000 }], {
        startedAtMs: BOUNDARY,
        targetCharacterId: 'a',
      }),
    ).toEqual(['a']);
  });

  it('excludes a bystander who joined after the channel began', () => {
    expect(
      eligible(
        [
          { id: 'a', joinedAtMs: BOUNDARY - 5_000 },
          { id: 'late', joinedAtMs: BOUNDARY + 500 },
        ],
        { startedAtMs: BOUNDARY, targetCharacterId: 'a' },
      ),
    ).toEqual(['a']);
  });

  it('excludes someone who left and re-entered during the same cast', () => {
    // Re-entry re-inserts the row with a later join stamp.
    expect(
      eligible([{ id: 'b', joinedAtMs: BOUNDARY + 1_200 }], {
        startedAtMs: BOUNDARY,
        targetCharacterId: 'a',
      }),
    ).toEqual([]);
  });

  it('excludes someone who left and stayed away', () => {
    expect(
      eligible([{ id: 'b', joinedAtMs: BOUNDARY - 9_000, present: false }], {
        startedAtMs: BOUNDARY,
        targetCharacterId: 'a',
      }),
    ).toEqual([]);
  });

  it('includes a re-entered character for an entirely NEW cast', () => {
    const rejoinedAt = BOUNDARY + 1_200;
    expect(
      eligible([{ id: 'b', joinedAtMs: rejoinedAt }], {
        startedAtMs: rejoinedAt + 2_000,
        targetCharacterId: 'a',
      }),
    ).toEqual(['b']);
  });

  it('never excludes a cast’s own frozen target over a clock-domain skew', () => {
    // Intake wall-clock is 380 ms LATER than the scheduled boundary the claim
    // carried; the boss still picked this character as its target that tick.
    const ids = eligible([{ id: 'target', joinedAtMs: BOUNDARY + 380 }], {
      startedAtMs: BOUNDARY,
      targetCharacterId: 'target',
    });
    expect(ids).toEqual(['target']);
  });

  it('the skew exception applies to the frozen target only, not to bystanders', () => {
    const ids = eligible(
      [
        { id: 'target', joinedAtMs: BOUNDARY + 380 },
        { id: 'bystander', joinedAtMs: BOUNDARY + 380 },
      ],
      { startedAtMs: BOUNDARY, targetCharacterId: 'target' },
    );
    expect(ids).toEqual(['target']);
  });

  it('a dead frozen target is still excluded', () => {
    expect(
      eligible([{ id: 'target', joinedAtMs: BOUNDARY + 380, alive: false }], {
        startedAtMs: BOUNDARY,
        targetCharacterId: 'target',
      }),
    ).toEqual([]);
  });

  it('an absent frozen target is still excluded (genuine empty ground)', () => {
    expect(
      eligible([{ id: 'target', joinedAtMs: BOUNDARY - 1_000, present: false }], {
        startedAtMs: BOUNDARY,
        targetCharacterId: 'target',
      }),
    ).toEqual([]);
  });
});
