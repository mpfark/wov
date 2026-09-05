export type Combat2IntentKind = 'ability' | 'stance_activate' | 'stance_drop' | 'basic_attack';

export interface Combat2IntentAction {
  kind: Combat2IntentKind;
  abilityKey: string | null;
  stanceKey: string | null;
  targetCreatureId: string | null;
}

export type Combat2IntentClassification =
  | 'queued'
  | 'already_queued'
  | 'maintenance'
  | 'invalid_request'
  | 'not_authorized'
  | 'no_encounter'
  | 'not_accepting_input'
  | 'not_at_node'
  | 'not_present'
  | 'ability_unavailable'
  | 'stance_unavailable'
  | 'invalid_target'
  | 'refused';

export type Combat2IntentOutcome =
  | { status: 'accepted'; classification: 'queued' | 'already_queued'; intentId: string; seq: number; intentStatus: string | null }
  | { status: 'refused'; classification: Exclude<Combat2IntentClassification, 'queued' | 'already_queued'>; reason: string | null };

interface IntentRpcResponse { data: unknown; error: { message?: string } | null }

export interface Combat2IntentClient {
  rpc(name: 'combat_intent', args: {
    _encounter_id: string;
    _character_id: string;
    _intent_kind: Combat2IntentKind;
    _ability_key: string | null;
    _stance_key: string | null;
    _target_creature_id: string | null;
    _request_id: string;
  }): PromiseLike<IntentRpcResponse>;
}

export interface Combat2IntentAdapter {
  submit(encounterId: string, characterId: string, action: Combat2IntentAction, requestId: string): Promise<Combat2IntentOutcome>;
}

export class Combat2IntentError extends Error {
  constructor(readonly code: 'uncertain' | 'error', message: string) {
    super(message);
    this.name = 'Combat2IntentError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function decodeCombat2Intent(value: unknown): Combat2IntentOutcome {
  const row = record(value);
  if (!row || typeof row.ok !== 'boolean' || typeof row.kind !== 'string') {
    throw new Combat2IntentError('error', 'combat_intent returned a malformed response');
  }
  if (row.ok === true && (row.kind === 'queued' || row.kind === 'already_queued')) {
    if (typeof row.intent_id !== 'string' || !UUID_RE.test(row.intent_id)
      || typeof row.seq !== 'number' || !Number.isSafeInteger(row.seq) || row.seq < 0) {
      throw new Combat2IntentError('error', 'combat_intent returned an invalid accepted result');
    }
    return {
      status: 'accepted',
      classification: row.kind,
      intentId: row.intent_id,
      seq: row.seq,
      intentStatus: typeof row.status === 'string' ? row.status : null,
    };
  }
  if (row.ok === false) {
    const known = new Set([
      'invalid_request', 'not_authorized', 'no_encounter', 'not_accepting_input',
      'not_at_node', 'not_present', 'ability_unavailable', 'stance_unavailable', 'invalid_target',
    ]);
    const classification = row.kind === 'mode_refused' && row.reason === 'maintenance'
      ? 'maintenance'
      : known.has(row.kind) ? row.kind : 'refused';
    return {
      status: 'refused',
      classification: classification as Exclude<Combat2IntentClassification, 'queued' | 'already_queued'>,
      reason: typeof row.reason === 'string' ? row.reason : null,
    };
  }
  throw new Combat2IntentError('error', 'combat_intent returned an unknown success classification');
}

export function createCombat2IntentAdapter(client: Combat2IntentClient): Combat2IntentAdapter {
  return {
    async submit(encounterId, characterId, action, requestId) {
      let response: IntentRpcResponse;
      try {
        response = await client.rpc('combat_intent', {
          _encounter_id: encounterId,
          _character_id: characterId,
          _intent_kind: action.kind,
          _ability_key: action.kind === 'ability' ? action.abilityKey : null,
          _stance_key: action.kind === 'ability' ? null : action.stanceKey,
          _target_creature_id: action.kind === 'ability' || action.kind === 'basic_attack'
            ? action.targetCreatureId
            : null,
          _request_id: requestId,
        });
      } catch (error) {
        throw new Combat2IntentError('uncertain', error instanceof Error ? error.message : 'combat_intent transport failed');
      }
      if (response.error) throw new Combat2IntentError('uncertain', response.error.message ?? 'combat_intent transport failed');
      return decodeCombat2Intent(response.data);
    },
  };
}
