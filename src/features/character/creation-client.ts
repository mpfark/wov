import { supabase } from '@/integrations/supabase/client';
import manifest from '../../../docs/design/progression-001G-C2-P2-A-creation-manifest.json';

export const creationManifest = manifest;
export interface CreationChoices {
  name: string;
  race: string;
  gender: 'male' | 'female';
  targetAccount?: string;
  reason?: string;
}
interface PendingCreation { request: string; choices: CreationChoices }
const key = (actor: string, target?: string) => `c2-creation:${actor}:${target ?? actor}`;
export function pendingCreation(actor: string, target?: string): PendingCreation | null {
  const raw = sessionStorage.getItem(key(actor, target));
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingCreation;
  if (!value.request || !value.choices) throw new Error('Invalid pending creation request.');
  return value;
}
export function acknowledgeCreation(actor: string, target?: string) {
  sessionStorage.removeItem(key(actor, target));
}
/** Keep the same intent across transport errors, reloads and read-after-write failures.
 * Never send character stats or call the private internal authority. */
export async function requestCreation(actor: string, input: CreationChoices) {
  const choices: CreationChoices = { name: input.name.trim(), race: input.race,
    gender: input.gender, ...(input.targetAccount ? { targetAccount: input.targetAccount,
      reason: input.reason?.trim() } : {}) };
  let pending = pendingCreation(actor, input.targetAccount);
  if (pending && JSON.stringify(pending.choices) !== JSON.stringify(choices)) {
    throw new Error('Retry the pending creation with its original choices before starting another.');
  }
  if (!pending) {
    pending = { request: crypto.randomUUID(), choices };
    // Fail before the RPC if persistence is unavailable: safe retries require this ID.
    sessionStorage.setItem(key(actor, input.targetAccount), JSON.stringify(pending));
  }
  const { data, error } = await supabase.rpc('character_create_c2' as never, {
    _request: pending.request, _name: choices.name, _race: choices.race,
    _gender: choices.gender, _target: choices.targetAccount ?? null,
    _reason: choices.reason ?? null, _expected_revision: manifest.versions.creation,
  } as never);
  if (error) {
    // Explicit PostgreSQL errors roll back the whole transaction. A transport failure
    // has no such proof, so keep its request UUID and bound choices.
    if (/^[0-9A-Z]{5}$/.test(error.code ?? '') && error.code !== 'PGRST') {
      acknowledgeCreation(actor, input.targetAccount);
    }
    throw error;
  }
  const result = data as unknown as { kind?: string; characterId?: string };
  if (!result || !['applied', 'purged'].includes(result.kind ?? '') || !result.characterId) {
    throw new Error('Unexpected creation response. Retry the same request.');
  }
  if (result.kind === 'purged') {
    acknowledgeCreation(actor, input.targetAccount);
    throw new Error('This creation request refers to a permanently purged character.');
  }
  return result.characterId;
}

export async function creationCapacity(target?: string): Promise<{ retained: number; limit: number }> {
  const { data, error } = await supabase.rpc('character_creation_capacity' as never,
    { _target: target ?? null } as never);
  if (error) throw error;
  const value = data as unknown as { retained: number; limit: number };
  if (!Number.isSafeInteger(value?.retained) || value.retained < 0 || value.limit !== 5) {
    throw new Error('Unexpected character capacity response.');
  }
  return value;
}
