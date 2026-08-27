/**
 * build-identity.ts — the ONE server build identifier for the combat edge pair.
 *
 * Why this exists: a stale deployment has now caused more than one misleading
 * production diagnosis. Twice, stored configuration was correct while the
 * running function decoded it with retired code, and nothing in any captured
 * response could tell the two apart. Every response from `combat-tick` and
 * `combat-catchup` — success AND refusal — now carries this string, so a
 * captured envelope alone proves which code produced it.
 *
 * Rules:
 *  - bump this whenever combat resolution behaviour changes and is deployed;
 *  - both functions import it from here, so they can never disagree;
 *  - it is a build label, never a secret and never simulation input.
 */
export const EDGE_COMBAT_BUILD_ID = 'r8-bosscast-lifecycle-buildid';

/**
 * Stamp the build identity onto any response body. Objects gain a
 * `serverBuild` field; a non-object body is wrapped so the identity is still
 * present. Never overwrites an identity a caller already set.
 */
export function stampCombatBuild<T>(body: T): T & { serverBuild: string } {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const rec = body as Record<string, unknown>;
    if (typeof rec.serverBuild === 'string') return body as T & { serverBuild: string };
    return { ...(body as object), serverBuild: EDGE_COMBAT_BUILD_ID } as T & { serverBuild: string };
  }
  return { body, serverBuild: EDGE_COMBAT_BUILD_ID } as unknown as T & { serverBuild: string };
}
