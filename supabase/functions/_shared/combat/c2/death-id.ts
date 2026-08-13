/**
 * c2/death-id.ts — the stable death occurrence id.
 *
 * A creature row can be killed, respawn, and be killed again. Reward
 * idempotency therefore cannot key on (encounter, creature, character): it
 * keys on a *death occurrence*, identified by encounter, creature, the
 * creature's spawn generation and the tick that killed it.
 *
 * This mirrors `public.encounter_death_id(uuid, uuid, integer, bigint)` exactly:
 *
 *   md5(encounter || ':' || creature || ':' || spawnSeq || ':' || tick)::uuid
 *
 * Postgres casts a 32-char md5 hex directly to uuid, so the TS side just
 * inserts the dashes.
 */

import { md5Hex } from './md5.ts';

export function encounterDeathId(
  encounterId: string,
  creatureId: string,
  spawnSeq: number,
  tickNumber: number,
): string {
  const seq = Number.isFinite(spawnSeq) && spawnSeq > 0 ? Math.trunc(spawnSeq) : 1;
  const hex = md5Hex(`${encounterId}:${creatureId}:${seq}:${Math.trunc(tickNumber)}`);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
