export type Combat2FleeClassification =
  | 'fled'
  | 'already_fled'
  | 'maintenance'
  | 'invalid_request'
  | 'not_authorized'
  | 'no_encounter'
  | 'not_at_node'
  | 'not_present'
  | 'refused';

export type Combat2FleeOutcome =
  | { status: 'fled'; classification: 'fled' | 'already_fled'; eventId: string; fighterId: string | null; stateVersion: number | null }
  | { status: 'refused'; classification: Exclude<Combat2FleeClassification, 'fled' | 'already_fled'>; reason: string | null };

interface FleeRpcResponse { data: unknown; error: { message?: string } | null }

export interface Combat2FleeClient {
  rpc(name: 'combat_flee', args: {
    _encounter_id: string;
    _character_id: string;
    _request_id: string;
  }): PromiseLike<FleeRpcResponse>;
}

export interface Combat2FleeAdapter {
  flee(encounterId: string, characterId: string, requestId: string): Promise<Combat2FleeOutcome>;
}

export class Combat2FleeError extends Error {
  constructor(readonly code: 'uncertain' | 'error', message: string) {
    super(message);
    this.name = 'Combat2FleeError';
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
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Combat2FleeError('error', 'combat_flee returned an invalid fighter id');
  }
  return value;
}

function optionalVersion(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Combat2FleeError('error', 'combat_flee returned an invalid state version');
  }
  return value;
}

export function decodeCombat2Flee(value: unknown): Combat2FleeOutcome {
  const row = record(value);
  if (!row || typeof row.ok !== 'boolean' || typeof row.kind !== 'string') {
    throw new Combat2FleeError('error', 'combat_flee returned a malformed response');
  }
  if (row.ok === true && (row.kind === 'fled' || row.kind === 'already_fled')) {
    if (typeof row.event_id !== 'string' || !UUID_RE.test(row.event_id)) {
      throw new Combat2FleeError('error', 'combat_flee returned an invalid event id');
    }
    return {
      status: 'fled',
      classification: row.kind,
      eventId: row.event_id,
      fighterId: optionalUuid(row.fighter_id),
      stateVersion: optionalVersion(row.state_version),
    };
  }
  if (row.ok === false) {
    const known = new Set(['invalid_request', 'not_authorized', 'no_encounter', 'not_at_node', 'not_present']);
    const classification = row.kind === 'mode_refused' && row.reason === 'maintenance'
      ? 'maintenance'
      : known.has(row.kind) ? row.kind : 'refused';
    return {
      status: 'refused',
      classification: classification as Exclude<Combat2FleeClassification, 'fled' | 'already_fled'>,
      reason: typeof row.reason === 'string' ? row.reason : null,
    };
  }
  throw new Combat2FleeError('error', 'combat_flee returned an unknown success classification');
}

export function createCombat2FleeAdapter(client: Combat2FleeClient): Combat2FleeAdapter {
  return {
    async flee(encounterId, characterId, requestId) {
      let response: FleeRpcResponse;
      try {
        response = await client.rpc('combat_flee', {
          _encounter_id: encounterId,
          _character_id: characterId,
          _request_id: requestId,
        });
      } catch (error) {
        throw new Combat2FleeError('uncertain', error instanceof Error ? error.message : 'combat_flee transport failed');
      }
      if (response.error) throw new Combat2FleeError('uncertain', response.error.message ?? 'combat_flee transport failed');
      return decodeCombat2Flee(response.data);
    },
  };
}
