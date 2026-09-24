import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameLogEvent } from '@/features/combat/events/log-event';

const archive = vi.hoisted(() => ({
  appendEvents: vi.fn(async () => [] as number[]),
  loadPage: vi.fn(),
  latestKey: vi.fn(async () => null as number | null),
  pruneCharacter: vi.fn(async () => 0),
}));

vi.mock('@/features/combat/events/log-archive', () => ({
  ...archive,
  MAX_ARCHIVED_EVENTS: 100_000,
}));

import { MAX_ARCHIVED_EVENTS } from '@/features/combat/events/log-archive';
import { PAGE_SIZE, useLogArchive } from './useLogArchive';

const event = (id: string, ts: number): GameLogEvent => ({
  v: 1, id, ts, type: 'system', message: id,
});
const row = (key: number, value: GameLogEvent) => ({ key, event: value });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('useLogArchive initial hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    archive.loadPage.mockResolvedValue([]);
  });
  afterEach(cleanup);

  it('shows the selected character stored log before any live Combat2 attachment', async () => {
    archive.loadPage.mockResolvedValue([row(2, event('newer', 2)), row(1, event('older', 1))]);
    const { result } = renderHook(() => useLogArchive('character-a', []));

    await waitFor(() => expect(result.current.olderEvents.map(item => item.id)).toEqual(['newer', 'older']));
    expect(archive.loadPage).toHaveBeenCalledWith('character-a', null, PAGE_SIZE);
  });

  it('requires no encounter or live event to hydrate retained history', async () => {
    archive.loadPage.mockResolvedValue([row(1, event('peaceful-history', 1))]);
    const { result } = renderHook(() => useLogArchive('character-a', []));
    await waitFor(() => expect(result.current.olderEvents[0]?.id).toBe('peaceful-history'));
  });

  it('merges later live encounter events without rendering or persisting stored events twice', async () => {
    const stored = event('stored', 1);
    const live = event('live', 2);
    archive.loadPage.mockResolvedValue([row(1, stored)]);
    const { result, rerender } = renderHook(({ events }) => useLogArchive('character-a', events), {
      initialProps: { events: [] as GameLogEvent[] },
    });
    await waitFor(() => expect(result.current.olderEvents.map(item => item.id)).toEqual(['stored']));

    rerender({ events: [stored, live] });
    await waitFor(() => expect(result.current.olderEvents).toEqual([]));
    expect(archive.appendEvents).not.toHaveBeenCalled();
  });

  it('clears the prior character immediately and hydrates only the new character', async () => {
    archive.loadPage.mockImplementation(async (characterId: string) => characterId === 'character-a'
      ? [row(1, event('a-only', 1))]
      : [row(2, event('b-only', 2))]);
    const { result, rerender } = renderHook(({ characterId }) => useLogArchive(characterId, []), {
      initialProps: { characterId: 'character-a' },
    });
    await waitFor(() => expect(result.current.olderEvents[0]?.id).toBe('a-only'));

    rerender({ characterId: 'character-b' });
    expect(result.current.olderEvents).toEqual([]);
    await waitFor(() => expect(result.current.olderEvents.map(item => item.id)).toEqual(['b-only']));
  });

  it('discards late hydration from an old character', async () => {
    const oldRead = deferred<ReturnType<typeof row>[]>();
    archive.loadPage.mockImplementation((characterId: string) => characterId === 'character-a'
      ? oldRead.promise
      : Promise.resolve([row(2, event('b-only', 2))]));
    const { result, rerender } = renderHook(({ characterId }) => useLogArchive(characterId, []), {
      initialProps: { characterId: 'character-a' },
    });

    rerender({ characterId: 'character-b' });
    await waitFor(() => expect(result.current.olderEvents[0]?.id).toBe('b-only'));
    await act(async () => oldRead.resolve([row(1, event('late-a', 1))]));
    expect(result.current.olderEvents.map(item => item.id)).toEqual(['b-only']);
  });

  it('restores the same character history after remount and keeps the retention bound', async () => {
    archive.loadPage.mockResolvedValue([row(2, event('newer', 2)), row(1, event('older', 1))]);
    const first = renderHook(() => useLogArchive('character-a', []));
    await waitFor(() => expect(first.result.current.olderEvents).toHaveLength(2));
    first.unmount();
    const second = renderHook(() => useLogArchive('character-a', []));
    await waitFor(() => expect(second.result.current.olderEvents.map(item => item.id)).toEqual(['newer', 'older']));
    expect(archive.pruneCharacter).toHaveBeenCalledWith('character-a', MAX_ARCHIVED_EVENTS);
  });

  it('preserves newest-first archive ordering and page-size bounded initial hydration', async () => {
    const page = Array.from({ length: PAGE_SIZE }, (_, index) => row(PAGE_SIZE - index, event(`event-${PAGE_SIZE - index}`, PAGE_SIZE - index)));
    archive.loadPage.mockResolvedValue(page);
    const { result } = renderHook(() => useLogArchive('character-a', []));
    await waitFor(() => expect(result.current.olderEvents).toHaveLength(PAGE_SIZE));
    expect(result.current.olderEvents[0]?.id).toBe(`event-${PAGE_SIZE}`);
    expect(result.current.olderEvents.at(-1)?.id).toBe('event-1');
    expect(result.current.hasMore).toBe(true);
  });
});
