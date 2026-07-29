/**
 * Verifies the on-device log archive: append, paged reverse reads, pruning
 * at the retention cap, and per-character isolation/clearing.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendEvents,
  loadPage,
  latestKey,
  pruneCharacter,
  clearCharacter,
  __resetArchiveForTests,
} from '@/features/combat/events/log-archive';
import type { GameLogEvent } from '@/features/combat/events/log-event';

const ev = (n: number): GameLogEvent =>
  ({ id: `e${n}`, type: 'system', message: `line ${n}` } as unknown as GameLogEvent);

describe('log-archive', () => {
  beforeEach(async () => {
    __resetArchiveForTests();
    await clearCharacter('char-a');
    await clearCharacter('char-b');
  });

  it('appends and reads back newest-first', async () => {
    const keys = await appendEvents('char-a', [ev(1), ev(2), ev(3)]);
    expect(keys).toHaveLength(3);
    const page = await loadPage('char-a', null, 10);
    expect(page.map(p => p.event.message)).toEqual(['line 3', 'line 2', 'line 1']);
  });

  it('pages older entries with a cursor', async () => {
    await appendEvents('char-a', [ev(1), ev(2), ev(3), ev(4), ev(5)]);
    const first = await loadPage('char-a', null, 2);
    expect(first.map(p => p.event.message)).toEqual(['line 5', 'line 4']);
    const second = await loadPage('char-a', first[first.length - 1].key, 2);
    expect(second.map(p => p.event.message)).toEqual(['line 3', 'line 2']);
    const third = await loadPage('char-a', second[second.length - 1].key, 2);
    expect(third.map(p => p.event.message)).toEqual(['line 1']);
    const empty = await loadPage('char-a', third[0].key, 2);
    expect(empty).toEqual([]);
  });

  it('prunes the oldest entries beyond the cap', async () => {
    await appendEvents('char-a', Array.from({ length: 20 }, (_, i) => ev(i + 1)));
    const deleted = await pruneCharacter('char-a', 5);
    expect(deleted).toBe(15);
    const all = await loadPage('char-a', null, 100);
    expect(all).toHaveLength(5);
    expect(all.map(p => p.event.message)).toEqual([
      'line 20', 'line 19', 'line 18', 'line 17', 'line 16',
    ]);
  });

  it('keeps characters isolated and clears one without touching the other', async () => {
    await appendEvents('char-a', [ev(1), ev(2)]);
    await appendEvents('char-b', [ev(9)]);
    expect(await loadPage('char-b', null, 10)).toHaveLength(1);
    await clearCharacter('char-a');
    expect(await loadPage('char-a', null, 10)).toHaveLength(0);
    expect(await loadPage('char-b', null, 10)).toHaveLength(1);
    expect(await latestKey('char-a')).toBeNull();
  });
});
