import { describe, expect, it } from 'vitest';

type Fighter = { present: boolean; hp: number };
type Encounter = {
  status: 'active' | 'ended';
  liveEngagedCreatures: number;
  claimExpiresAt: number | null;
};

function combatOwns(now: number, fighter: Fighter, encounter: Encounter): boolean {
  if (encounter.status !== 'active' || !fighter.present) return false;
  return encounter.liveEngagedCreatures > 0
    || (encounter.claimExpiresAt !== null && encounter.claimExpiresAt > now);
}

function settle(input: {
  now: number;
  bucket: number;
  releasedAt: number | null;
  fighter: Fighter;
  encounter: Encounter;
  resources: { hp: number; cp: number; mp: number };
  dead?: boolean;
}) {
  if (input.dead || input.fighter.hp <= 0) return input.resources;
  if (input.releasedAt !== null && input.releasedAt >= input.bucket) return input.resources;
  if (combatOwns(input.now, input.fighter, input.encounter)) return input.resources;
  return { hp: input.resources.hp + 3, cp: input.resources.cp + 4, mp: input.resources.mp + 5 };
}

const active = (overrides: Partial<Encounter> = {}): Encounter => ({
  status: 'active', liveEngagedCreatures: 1, claimExpiresAt: 110, ...overrides,
});
const fighter = (overrides: Partial<Fighter> = {}): Fighter => ({ present: true, hp: 10, ...overrides });
const resources = { hp: 10, cp: 10, mp: 10 };

describe('Combat2 completion to resource-settlement ownership', () => {
  it('keeps the final combat-owned interval ineligible and grants no banked regeneration', () => {
    expect(settle({ now: 100, bucket: 100, releasedAt: null, fighter: fighter(), encounter: active(), resources }))
      .toEqual(resources);
    expect(settle({ now: 104, bucket: 104, releasedAt: 101, fighter: fighter({ present: false }),
      encounter: active({ status: 'ended', liveEngagedCreatures: 0, claimExpiresAt: null }), resources }))
      .toEqual({ hp: 13, cp: 14, mp: 15 });
  });

  it.each([
    ['aggressive', active({ liveEngagedCreatures: 0, claimExpiresAt: null })],
    ['peaceful deliberately engaged', active({ liveEngagedCreatures: 0, claimExpiresAt: null })],
  ])('ends and releases every survivor for a %s encounter', (_label, encounter) => {
    encounter.status = 'ended';
    const survivors = [fighter(), fighter()];
    survivors.forEach(entry => { entry.present = false; });
    for (const survivor of survivors) {
      expect(combatOwns(104, survivor, encounter)).toBe(false);
      expect(settle({ now: 104, bucket: 104, releasedAt: 101, fighter: survivor, encounter, resources }))
        .toEqual({ hp: 13, cp: 14, mp: 15 });
    }
  });

  it('does not let a live or expired claim retain an absent historical fighter', () => {
    const absent = fighter({ present: false });
    expect(combatOwns(100, absent, active({ liveEngagedCreatures: 0, claimExpiresAt: 110 }))).toBe(false);
    expect(combatOwns(111, fighter(), active({ liveEngagedCreatures: 0, claimExpiresAt: 110 }))).toBe(false);
  });

  it('keeps dead fighters excluded while releasing a surviving party member', () => {
    const ended = active({ status: 'ended', liveEngagedCreatures: 0, claimExpiresAt: null });
    expect(settle({ now: 104, bucket: 104, releasedAt: 101, fighter: fighter({ present: false, hp: 0 }),
      encounter: ended, resources, dead: true })).toEqual(resources);
    expect(settle({ now: 104, bucket: 104, releasedAt: 101, fighter: fighter({ present: false }),
      encounter: ended, resources })).toEqual({ hp: 13, cp: 14, mp: 15 });
  });

  it('is replay-safe and does not settle twice inside one four-second bucket', () => {
    const ended = active({ status: 'ended', liveEngagedCreatures: 0, claimExpiresAt: null });
    const first = settle({ now: 104, bucket: 104, releasedAt: 101, fighter: fighter({ present: false }), encounter: ended, resources });
    const cursorAlreadySettled = true;
    const replay = cursorAlreadySettled ? first : settle({ now: 104, bucket: 104, releasedAt: 101,
      fighter: fighter({ present: false }), encounter: ended, resources: first });
    expect(replay).toEqual(first);
  });

  it('allows immediate new combat to reacquire ownership without overlap', () => {
    const released = fighter({ present: false });
    expect(combatOwns(104, released, active({ liveEngagedCreatures: 1, claimExpiresAt: 110 }))).toBe(false);
    const reentered = fighter({ present: true });
    expect(combatOwns(104, reentered, active({ liveEngagedCreatures: 1, claimExpiresAt: 110 }))).toBe(true);
  });
});
