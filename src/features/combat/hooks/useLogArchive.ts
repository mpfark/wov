/**
 * Owns: bridging the live in-memory event log to the on-device archive.
 *
 * - Appends every new live event to IndexedDB (batched, ~1s flush).
 * - Serves older pages back for infinite scrollback in the log panel.
 * - Prunes the archive to MAX_ARCHIVED_EVENTS per character.
 *
 * State ownership: the live log stays owned by GamePage; this hook only
 * mirrors it and owns the *older* (already-evicted) slice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import {
  appendEvents,
  loadPage,
  latestKey,
  pruneCharacter,
  MAX_ARCHIVED_EVENTS,
} from '@/features/combat/events/log-archive';

const FLUSH_MS = 1000;
const PRUNE_MS = 5 * 60 * 1000;
export const PAGE_SIZE = 200;

export interface LogArchive {
  /** Older events, newest-first, already evicted from the live log. */
  olderEvents: GameLogEvent[];
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
}

export function useLogArchive(
  characterId: string | null | undefined,
  liveLog: GameLogEvent[],
): LogArchive {
  const [olderEvents, setOlderEvents] = useState<GameLogEvent[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const queueRef = useRef<GameLogEvent[]>([]);
  const keyByEventRef = useRef<Map<string, number>>(new Map());
  const lastSeenIdRef = useRef<string | null>(null);
  const cursorRef = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const hydrationEpochRef = useRef(0);
  const archiveOwnerRef = useRef<string | null>(null);
  const liveLogRef = useRef(liveLog);
  liveLogRef.current = liveLog;

  // Reset and immediately hydrate the selected character's newest archived
  // page. The epoch and owner fence prevent a slower previous-character read
  // from becoming visible after a character switch.
  useEffect(() => {
    const epoch = ++hydrationEpochRef.current;
    archiveOwnerRef.current = characterId ?? null;
    queueRef.current = [];
    keyByEventRef.current = new Map();
    lastSeenIdRef.current = null;
    cursorRef.current = null;
    loadingRef.current = false;
    setOlderEvents([]);
    setHasMore(!!characterId);
    setLoadingOlder(false);
    if (!characterId) return;

    void (async () => {
      const page = await loadPage(characterId, null, PAGE_SIZE);
      if (hydrationEpochRef.current !== epoch || archiveOwnerRef.current !== characterId) return;

      const storedIds = new Set(page.map(({ event }) => event.id).filter(Boolean));
      for (const { key, event } of page) {
        if (event.id) keyByEventRef.current.set(event.id, key);
      }
      // A live model can attach while IndexedDB is opening. Never persist or
      // render those already archived events twice.
      queueRef.current = queueRef.current.filter(event => !event.id || !storedIds.has(event.id));
      const liveIds = new Set(liveLogRef.current.map(event => event.id).filter(Boolean));
      setOlderEvents(page.map(({ event }) => event).filter(event => !event.id || !liveIds.has(event.id)));
      cursorRef.current = page.length ? page[page.length - 1].key : null;
      setHasMore(page.length === PAGE_SIZE);
    })();

    return () => {
      if (hydrationEpochRef.current === epoch) hydrationEpochRef.current++;
    };
  }, [characterId]);

  // ── Append path ────────────────────────────────────────────────
  useEffect(() => {
    if (!characterId || liveLog.length === 0) return;
    const lastSeen = lastSeenIdRef.current;
    let fresh: GameLogEvent[];
    if (!lastSeen) {
      fresh = liveLog;
    } else {
      const idx = liveLog.findIndex(e => e.id === lastSeen);
      fresh = idx === -1 ? liveLog : liveLog.slice(idx + 1);
    }
    if (fresh.length === 0) return;
    lastSeenIdRef.current = liveLog[liveLog.length - 1].id ?? lastSeen;
    const persisted = fresh.filter(event => !event.id || !keyByEventRef.current.has(event.id));
    queueRef.current.push(...persisted);
    const liveIds = new Set(liveLog.map(event => event.id).filter(Boolean));
    setOlderEvents(previous => previous.filter(event => !event.id || !liveIds.has(event.id)));
  }, [liveLog, characterId]);

  const flush = useCallback(async () => {
    if (!characterId) return;
    const batch = queueRef.current;
    if (batch.length === 0) return;
    queueRef.current = [];
    const keys = await appendEvents(characterId, batch);
    keys.forEach((key, i) => {
      const id = batch[i]?.id;
      if (id) keyByEventRef.current.set(id, key);
    });
    // Keep the id→key map bounded; only recent events can be the paging anchor.
    const map = keyByEventRef.current;
    if (map.size > 1000) {
      const drop = map.size - 500;
      let n = 0;
      for (const k of map.keys()) {
        if (n++ >= drop) break;
        map.delete(k);
      }
    }
  }, [characterId]);

  useEffect(() => {
    if (!characterId) return;
    const id = window.setInterval(() => { void flush(); }, FLUSH_MS);
    const onHide = () => { void flush(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void flush();
    };
  }, [characterId, flush]);

  // ── Pruning ────────────────────────────────────────────────────
  useEffect(() => {
    if (!characterId) return;
    void pruneCharacter(characterId, MAX_ARCHIVED_EVENTS);
    const id = window.setInterval(() => {
      void pruneCharacter(characterId, MAX_ARCHIVED_EVENTS);
    }, PRUNE_MS);
    return () => window.clearInterval(id);
  }, [characterId]);

  // ── Scrollback ─────────────────────────────────────────────────
  const loadOlder = useCallback(() => {
    if (!characterId || loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    void (async () => {
      try {
        // Make sure anything queued is persisted so the anchor key exists.
        await flush();
        if (cursorRef.current === null) {
          // Anchor: the oldest live event we know a key for, else newest stored.
          let anchor: number | null = null;
          for (const e of liveLogRef.current) {
            const k = e.id ? keyByEventRef.current.get(e.id) : undefined;
            if (k !== undefined) { anchor = k; break; }
          }
          if (anchor === null) {
            const newest = await latestKey(characterId);
            anchor = newest === null ? null : newest + 1;
          }
          if (anchor === null) {
            setHasMore(false);
            return;
          }
          cursorRef.current = anchor;
        }
        const page = await loadPage(characterId, cursorRef.current, PAGE_SIZE);
        if (page.length === 0) {
          setHasMore(false);
          return;
        }
        cursorRef.current = page[page.length - 1].key;
        setOlderEvents(prev => [...prev, ...page.map(p => p.event)]);
        if (page.length < PAGE_SIZE) setHasMore(false);
      } finally {
        loadingRef.current = false;
        setLoadingOlder(false);
      }
    })();
  }, [characterId, hasMore, flush]);

  return {
    olderEvents: archiveOwnerRef.current === characterId ? olderEvents : [],
    hasMore: archiveOwnerRef.current === characterId && hasMore,
    loadingOlder: archiveOwnerRef.current === characterId && loadingOlder,
    loadOlder,
  };
}
