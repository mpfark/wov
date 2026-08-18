/**
 * tick-request.ts — the request body every live `combat-tick` call sends.
 *
 * Why this is a module and not an inline object literal: the party branch of the
 * driver used to send `{ party_id, node_id, ... }` with NO `character_id`, while
 * `combat-tick` requires `character_id` to verify ownership (`400
 * invalid_request` otherwise) and to resolve the encounter. Solo combat
 * therefore worked and party combat could not tick at all. The identity is now
 * built in one pure place so it cannot differ per branch, and a test pins it.
 */

export interface TickRequestInput {
  /** The calling character. ALWAYS sent: it is the ownership subject. */
  characterId: string;
  /** Party context, when the caller drives a party encounter. */
  partyId?: string | null;
  nodeId?: string | null;
  memberBuffs?: Record<string, unknown>;
  engagedCreatureIds?: readonly string[];
}

export interface TickRequestBody {
  character_id: string;
  party_id?: string;
  node_id: string | null;
  member_buffs: Record<string, unknown>;
  engaged_creature_ids: readonly string[];
}

export function buildTickRequestBody(input: TickRequestInput): TickRequestBody {
  const body: TickRequestBody = {
    // Ownership subject first: the server verifies this character belongs to the
    // caller before it resolves anything, for solo AND party requests.
    character_id: input.characterId,
    node_id: input.nodeId ?? null,
    member_buffs: input.memberBuffs ?? {},
    engaged_creature_ids: input.engagedCreatureIds ?? [],
  };
  if (input.partyId) body.party_id = input.partyId;
  return body;
}
