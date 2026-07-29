/**
 * Owns: the on-device archive of structured event-log entries.
 *
 * The server-side log is deliberately capped (cost), and the in-memory log
 * keeps only the newest ~100 events. This module persists the *full* log for
 * a character in the player's own browser (IndexedDB) so the log panel can
 * scroll back through their whole history.
 *
 * Everything here fails soft: if IndexedDB is unavailable (private mode,
 * quota, old browser) every call becomes a no-op. Logging must never break
 * gameplay.
 */
import type { GameLogEvent } from '@/features/combat/events/log-event';

const DB_NAME = 'wov-log';
const DB_VERSION = 1;
const STORE = 'events';
const CHAR_INDEX = 'characterId';

export const MAX_ARCHIVED_EVENTS = 100_000;

/** Row shape as stored. `key` is the auto-increment primary key. */
interface ArchiveRow {
  characterId: string;
  at: number;
  event: GameLogEvent;
}

export interface ArchivedEvent {
  key: number;
  event: GameLogEvent;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true });
          store.createIndex(CHAR_INDEX, 'characterId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** Test seam — drops the cached connection so a fresh open happens. */
export function __resetArchiveForTests() {
  dbPromise = null;
}

/**
 * Appends events for a character. Resolves with the assigned primary keys in
 * the same order (empty array when the archive is unavailable).
 */
export async function appendEvents(
  characterId: string,
  events: GameLogEvent[],
): Promise<number[]> {
  if (!characterId || events.length === 0) return [];
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const keys: number[] = [];
      for (const event of events) {
        const row: ArchiveRow = { characterId, at: Date.now(), event };
        const req = store.add(row as unknown as Record<string, unknown>);
        req.onsuccess = () => keys.push(req.result as number);
      }
      tx.oncomplete = () => resolve(keys);
      tx.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Reads up to `limit` events for a character, newest first, strictly older
 * than `beforeKey` (pass `null` to start from the newest entry).
 */
export async function loadPage(
  characterId: string,
  beforeKey: number | null,
  limit: number,
): Promise<ArchivedEvent[]> {
  if (!characterId || limit <= 0) return [];
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const index = tx.objectStore(STORE).index(CHAR_INDEX);
      const out: ArchivedEvent[] = [];
      const req = index.openCursor(IDBKeyRange.only(characterId), 'prev');
      let positioned = beforeKey === null;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(out);
        if (!positioned) {
          positioned = true;
          // Jump straight to the first entry older than the cursor key.
          if ((cursor.primaryKey as number) >= beforeKey!) {
            try {
              cursor.continuePrimaryKey(characterId, beforeKey! - 1);
              return;
            } catch {
              return resolve(out);
            }
          }
        }
        const row = cursor.value as ArchiveRow & { key: number };
        out.push({ key: cursor.primaryKey as number, event: row.event });
        if (out.length >= limit) return resolve(out);
        cursor.continue();
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve([]);
    }
  });
}

/** Newest stored key for a character, or null when nothing is stored. */
export async function latestKey(characterId: string): Promise<number | null> {
  const page = await loadPage(characterId, null, 1);
  return page.length ? page[0].key : null;
}

/** Deletes the oldest rows beyond `max` for a character. */
export async function pruneCharacter(
  characterId: string,
  max: number = MAX_ARCHIVED_EVENTS,
): Promise<number> {
  if (!characterId) return 0;
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const index = tx.objectStore(STORE).index(CHAR_INDEX);
      const countReq = index.count(IDBKeyRange.only(characterId));
      let deleted = 0;
      countReq.onsuccess = () => {
        const excess = (countReq.result || 0) - max;
        if (excess <= 0) return;
        const cursorReq = index.openCursor(IDBKeyRange.only(characterId), 'next');
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || deleted >= excess) return;
          cursor.delete();
          deleted++;
          cursor.continue();
        };
      };
      tx.oncomplete = () => resolve(deleted);
      tx.onerror = () => resolve(deleted);
      tx.onabort = () => resolve(deleted);
    } catch {
      resolve(0);
    }
  });
}

/** Removes every archived event for a character (used on character deletion). */
export async function clearCharacter(characterId: string): Promise<void> {
  if (!characterId) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const index = tx.objectStore(STORE).index(CHAR_INDEX);
      const req = index.openCursor(IDBKeyRange.only(characterId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
