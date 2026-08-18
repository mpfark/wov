/**
 * The tick request must always identify the calling character.
 *
 * `combat-tick` verifies ownership from `character_id` and rejects a body
 * without one (`400 invalid_request`). The party branch of the driver used to
 * send `{ party_id, node_id, ... }` only, so solo combat ticked and party combat
 * could not resolve a single tick. One builder now serves both paths.
 */
import { describe, it, expect } from 'vitest';
import { buildTickRequestBody } from '@/shared/combat/tick-request';

const CHAR = '00000000-0000-4000-8000-00000000c001';
const PARTY = '00000000-0000-4000-8000-00000000p001';

describe('combat-tick request identity', () => {
  it('sends the calling character in the solo path', () => {
    const body = buildTickRequestBody({ characterId: CHAR, nodeId: 'node-1' });
    expect(body.character_id).toBe(CHAR);
    expect(body.party_id).toBeUndefined();
    expect(body.member_buffs).toEqual({});
    expect(body.engaged_creature_ids).toEqual([]);
  });

  it('sends the calling character in the party path too', () => {
    const body = buildTickRequestBody({
      characterId: CHAR,
      partyId: PARTY,
      nodeId: 'node-1',
      engagedCreatureIds: ['c1'],
    });
    expect(body.character_id).toBe(CHAR);
    expect(body.party_id).toBe(PARTY);
    expect(body.engaged_creature_ids).toEqual(['c1']);
  });

  it('never omits the ownership subject, whatever the context', () => {
    for (const partyId of [null, undefined, PARTY]) {
      const body = buildTickRequestBody({ characterId: CHAR, partyId, nodeId: null });
      expect(typeof body.character_id).toBe('string');
      expect(body.character_id.length).toBeGreaterThan(0);
    }
  });
});
