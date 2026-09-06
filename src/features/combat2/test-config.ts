import { COMBAT2_CLIENT_ENABLED, COMBAT2_TEST_CHARACTER_ID } from '@/shared/config/feature-flags';
import { isCombat2TestArenaNode } from './arena-identity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Exactly one UUID per setting. Malformed or absent configuration denies all. */
export function testIdentityMatches(enabled: boolean, character: string, node: string | null, characterSetting: unknown) {
  return enabled && typeof characterSetting === 'string' && UUID.test(characterSetting)
    && character.toLowerCase() === characterSetting.toLowerCase() && isCombat2TestArenaNode(node);
}

/** Parent resource writers use the same arena-scoped rollout decision as GamePage. */
export function isConfiguredCombat2Tester(characterId: string | null | undefined, nodeId: string | null | undefined) {
  return !!characterId && testIdentityMatches(COMBAT2_CLIENT_ENABLED, characterId, nodeId ?? null, COMBAT2_TEST_CHARACTER_ID);
}
