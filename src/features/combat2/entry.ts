export type Combat2EntryClassification =
  | 'entered'
  | 'reentered'
  | 'reactivated'
  | 'already_entered'
  | 'already_present';

export type Combat2EntryRefusal =
  | 'maintenance'
  | 'no_living_creatures'
  | 'not_authorized'
  | 'no_node'
  | 'node_changed'
  | 'invalid_request'
  | 'refused';

export type Combat2EntryOutcome =
  | {
      status: 'entered';
      classification: Combat2EntryClassification;
      encounterId: string;
      fighterId: string | null;
      entrySeq: number | null;
    }
  | {
      status: 'refused';
      classification: Combat2EntryRefusal;
      reason: string | null;
    };

interface EntryRpcResponse { data: unknown; error: { message?: string } | null }

export interface Combat2EntryClient {
  rpc(name: 'combat_enter', args: { _character_id: string; _request_id: string }): PromiseLike<EntryRpcResponse>;
}

export interface Combat2EntryAdapter {
  enter(characterId: string, requestId: string): Promise<Combat2EntryOutcome>;
}

export class Combat2EntryError extends Error {
  constructor(readonly code: 'uncertain' | 'error', message: string) {
    super(message);
    this.name = 'Combat2EntryError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalUuid(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Combat2EntryError('error', 'combat_enter returned an invalid fighter id');
  return value;
}

function optionalSequence(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Combat2EntryError('error', 'combat_enter returned an invalid entry sequence');
  }
  return value;
}

export function decodeCombat2Entry(value: unknown): Combat2EntryOutcome {
  const row = record(value);
  if (!row || typeof row.kind !== 'string' || typeof row.ok !== 'boolean') {
    throw new Combat2EntryError('error', 'combat_enter returned a malformed response');
  }

  const successful = row.kind === 'entered' || row.kind === 'reentered' || row.kind === 'already_entered';
  const idempotentPresent = row.kind === 'already_present';
  if ((successful && row.ok === true) || (idempotentPresent && row.ok === false)) {
    if (typeof row.encounter_id !== 'string' || !UUID_RE.test(row.encounter_id)) {
      throw new Combat2EntryError('error', 'combat_enter returned an invalid encounter id');
    }
    const classification: Combat2EntryClassification = row.reactivated === true
      ? 'reactivated'
      : row.kind as Combat2EntryClassification;
    return {
      status: 'entered',
      classification,
      encounterId: row.encounter_id,
      fighterId: optionalUuid(row.fighter_id),
      entrySeq: optionalSequence(row.entry_seq),
    };
  }

  if (row.ok === false) {
    const classification: Combat2EntryRefusal = row.kind === 'mode_refused' && row.reason === 'maintenance'
      ? 'maintenance'
      : row.kind === 'no_living_creatures'
        ? 'no_living_creatures'
        : row.kind === 'not_authorized'
          ? 'not_authorized'
          : row.kind === 'no_node'
            ? 'no_node'
            : row.kind === 'node_changed'
              ? 'node_changed'
              : row.kind === 'invalid_request'
                ? 'invalid_request'
                : 'refused';
    return { status: 'refused', classification, reason: typeof row.reason === 'string' ? row.reason : null };
  }

  throw new Combat2EntryError('error', 'combat_enter returned an unknown success classification');
}

export function createCombat2EntryAdapter(client: Combat2EntryClient): Combat2EntryAdapter {
  return {
    async enter(characterId, requestId) {
      let response: EntryRpcResponse;
      try {
        response = await client.rpc('combat_enter', { _character_id: characterId, _request_id: requestId });
      } catch (error) {
        throw new Combat2EntryError('uncertain', error instanceof Error ? error.message : 'combat_enter transport failed');
      }
      if (response.error) throw new Combat2EntryError('uncertain', response.error.message ?? 'combat_enter transport failed');
      return decodeCombat2Entry(response.data);
    },
  };
}
