import { COMBAT2_CLIENT_ENABLED, COMBAT2_TEST_CHARACTER_ID, COMBAT2_TEST_NODE_ID } from '@/shared/config/feature-flags';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Exactly one UUID per setting. Malformed or absent configuration denies all. */
export function testIdentityMatches(enabled: boolean, character: string, node: string | null, characterSetting: unknown, nodeSetting: unknown) {
  return enabled && typeof characterSetting === 'string' && typeof nodeSetting === 'string'
    && UUID.test(characterSetting) && UUID.test(nodeSetting)
    && character.toLowerCase() === characterSetting.toLowerCase() && node?.toLowerCase() === nodeSetting.toLowerCase();
}

/** Parent resource writers must suspend before GamePage mounts, including off-node relocation. */
export function isConfiguredCombat2Tester(characterId: string | null | undefined) {
  return !!characterId && testIdentityMatches(COMBAT2_CLIENT_ENABLED, characterId,
    COMBAT2_TEST_NODE_ID, COMBAT2_TEST_CHARACTER_ID, COMBAT2_TEST_NODE_ID);
}
