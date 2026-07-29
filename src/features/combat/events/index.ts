/**
 * Structured game log events (Phase 3).
 *
 * Import from here rather than reaching into individual modules:
 *   - log-event.ts     — the canonical event shape + server type map
 *   - presentation.ts  — meaning → visual family (the ONLY styling source)
 *   - legacy-adapter.ts — temporary string → event boundary (see its header)
 */
export * from './log-event';
export { presentationForEvent } from './presentation';
export { legacyStringToEvent, rewriteLegacyRemote } from './legacy-adapter';
