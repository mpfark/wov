/**
 * c2/deaths.ts — structured character-death derivation.
 *
 * The pure resolver already reports `died` on a character mutation and emits
 * the presentation events that explain why. C2 turns that into exactly one
 * `CharacterDeathProposal` per character per tick, with attribution taken from
 * the last damaging event addressed to that character in the same tick.
 *
 * Direct damage, DoT ticks and boss cast / Stored Power releases all resolve
 * through this single path, so a character who dies from a DoT during a boss
 * cast still produces one death event, never two.
 */

import type { ProposedTick, PresentationEvent } from '../pure/types';
import type { CharacterDeathProposal } from './contract';

function classifySource(type: string): CharacterDeathProposal['sourceKind'] {
  const t = type.toLowerCase();
  if (t.includes('dot') || t.includes('bleed') || t.includes('poison') || t.includes('burn')) {
    return 'dot';
  }
  if (t.includes('cast') || t.includes('stored_power')) return 'boss_cast';
  if (t.includes('damage') || t.includes('hit') || t.includes('attack') || t.includes('crit')) {
    return 'damage';
  }
  return 'unknown';
}

function isAddressedDamage(event: PresentationEvent, characterId: string): boolean {
  return (
    event.characterId === characterId &&
    event.amount !== null &&
    event.amount > 0 &&
    classifySource(event.type) !== 'unknown'
  );
}

export function deriveCharacterDeaths(proposed: ProposedTick): CharacterDeathProposal[] {
  const events = [...proposed.events].sort((a, b) => a.seq - b.seq);
  const seen = new Set<string>();
  const deaths: CharacterDeathProposal[] = [];

  for (const mutation of proposed.characters) {
    if (!mutation.died) continue;
    if (seen.has(mutation.characterId)) continue;
    seen.add(mutation.characterId);

    let attribution: PresentationEvent | null = null;
    for (const event of events) {
      if (isAddressedDamage(event, mutation.characterId)) attribution = event;
    }

    deaths.push({
      characterId: mutation.characterId,
      tickNumber: proposed.tickNumber,
      sourceKind: attribution ? classifySource(attribution.type) : 'unknown',
      sourceCreatureId: attribution?.creatureId ?? null,
      sourceCharacterId: null,
      amount: attribution?.amount ?? null,
      damageType: attribution?.damageType ?? null,
    });
  }

  return deaths.sort((a, b) => (a.characterId < b.characterId ? -1 : 1));
}
