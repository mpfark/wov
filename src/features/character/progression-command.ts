import { supabase } from '@/integrations/supabase/client';
import type { ProgressionAction, ProgressionRequest } from '../../../supabase/functions/_shared/progression-command';
import { parseProgressionRequest } from '../../../supabase/functions/_shared/progression-command';
export type { ProgressionAction };
export interface CommandResult { kind: 'committed' | 'replayed' | 'refused'; reason?: string }
interface Transport { read: () => Promise<number>; send: (request: ProgressionRequest) => Promise<CommandResult> }
const inFlight = new Set<string>();
export function pendingProgressionAction(characterId: string): ProgressionAction | null {
  try {
    const request = parseProgressionRequest(JSON.parse(sessionStorage.getItem(`wov:progression-request:${characterId}`) ?? 'null'));
    if (!request || request.characterId !== characterId) return null;
    return 'allocations' in request ? { allocations: request.allocations } : { operation: request.operation, targetClass: request.targetClass };
  } catch { return null; }
}
export function pendingAllocation(characterId: string): Record<string, number> {
  const action = pendingProgressionAction(characterId);
  return action && 'allocations' in action ? action.allocations : {};
}
/** Persist uncertain request identity; a retry cannot replace its payload or starting version. */
export function createProgressionClient(characterId: string, transport: Transport,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, makeUuid = () => crypto.randomUUID()) {
  const key = `wov:progression-request:${characterId}`;
  let running = false;
  return {
    async execute(action: ProgressionAction): Promise<CommandResult> {
      if (running || inFlight.has(key)) throw new Error('A progression command is already pending.');
      running = true;
      inFlight.add(key);
      try {
        const normalized: ProgressionAction = 'allocations' in action
          ? { allocations: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map(k => [k, action.allocations[k] ?? 0])) }
          : { operation: action.operation, targetClass: action.targetClass };
        const pending = storage.getItem(key);
        let request: ProgressionRequest;
        if (pending) {
          request = JSON.parse(pending);
          const oldAction = 'allocations' in request ? { allocations: request.allocations } : { operation: request.operation, targetClass: request.targetClass };
          if (JSON.stringify(oldAction) !== JSON.stringify(normalized)) throw new Error('Retry the pending progression command before changing your choices.');
        } else {
          request = { ...normalized, characterId, requestId: makeUuid(), expectedVersion: await transport.read() };
          storage.setItem(key, JSON.stringify(request));
        }
        const result = await transport.send(request);
        if (!result || !['committed', 'replayed', 'refused'].includes(result.kind)) throw new Error('Command outcome is uncertain. Retry the same choices.');
        storage.removeItem(key);
        return result;
      } finally { running = false; inFlight.delete(key); }
    },
  };
}
export function progressionClient(characterId: string) {
  return createProgressionClient(characterId, {
    async read() {
      // Local boundary: official Cloud-derived types remain unchanged until installation.
      const { data, error } = await supabase.rpc('progression_command_projection' as never, { _character: characterId } as never);
      const result = data as unknown as { kind: string; projection?: { progressionVersion: number } };
      if (error) throw error;
      if (result?.kind !== 'current' || !Number.isSafeInteger(result.projection?.progressionVersion)) throw new Error('Progression commands are unavailable.');
      return result.projection!.progressionVersion;
    },
    async send(request) {
      const { data, error } = await supabase.functions.invoke('progression-command', { body: request });
      if (error) throw new Error('Command outcome is uncertain. Retry the same choices.');
      return data as CommandResult;
    },
  }, sessionStorage);
}
