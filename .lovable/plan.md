# Phase 3 — Structured Event Log (approved, with amendments)

Goal: structured fields become the source of truth for category, styling, severity, routing and future filtering. Emojis become inert prose. No configurable filters in this phase.

## 1. Current data flow (verified)

```text
SERVER combat-tick / combat-catchup / kill-resolver
  events[] = { type, message, character_id?, creature_id?, creature_name? }   // 41 types already exist
        ▼ HTTP
interpretCombatTickResult()  — DISCARDS type, keeps message, does name→You regex
        ▼ string
17 client files → addLog(string)  (173 call sites)
        ▼
bus 'log' / 'log:local'  { message: string }
   ├─ setEventLog(string[])
   ├─ party_combat_log INSERT (message text, client-generated row id)
   └─ broadcast 'party_combat_msg' { id, message, node_id, character_name }
              ▼ other client
        processIncomingLog(): You→Name regex → setEventLog
              ▼
        GamePage chat split via classifyLogLine(string)
              ▼
        EventLogLine → classifyLogLine + toPresentation (emoji + keyword regex)
```

## 2. Event schema (`src/features/combat/events/log-event.ts`)

```ts
export interface GameLogEvent {
  v: 1;
  id: string;                 // generated ONCE at the authoritative emitter
  ts: number;
  type: LogEventType;
  message: string;            // clean local/self-facing prose
  remoteMessage?: string;     // clean party-observer prose (no regex rewriting)
  source?: LogActor;          // { kind: 'player'|'creature'|'npc'|'world', id?, name? }
  target?: LogActor;
  amount?: number;
  amountKind?: 'damage'|'heal'|'block'|'absorb'|'xp'|'gold'|'resource';
  damageType?: string;
  effectType?: string;
  severity?: LogSeverity;     // only when it differs from the type default
  crit?: boolean;
  scope?: 'self'|'party'|'node'|'global';
  legacy?: { raw: string };   // ADAPTER-ONLY, removed with the adapter
}
```

No `family` on the event — presentation derives it. `severity` is omitted unless it deviates from the type default.

### Perspective (amended)

`perspective` is dropped. Emitters that read differently for observers author **both** strings: `message` (local) and `remoteMessage` (observer). No `You/your` regex on migrated events. The legacy adapter keeps the existing regex for old strings only.

## 3. Presentation (`src/features/combat/events/presentation.ts`)

One map, keyed by `type`, giving `family`, default `severity`, and `marker`. `attack | ability | proc | debuff` resolve `action` vs `threat` from `source.kind` (player → action, creature/npc/world → threat) — never from wording. Markers only render when severity ≠ `routine`. Families unchanged: action / threat / support / ambient / notable / telegraph / chat.

## 4. Server type mapping

`SERVER_EVENT_TYPE_MAP` covers all 41 known server types exhaustively (compile-time `Record<ServerEventType, LogEventType>`), with a test asserting completeness. Unknown structured types → `unknown` (ambient, `console.warn` once) — never message-parsed, never demoted to `legacy`. `legacy` is reserved for genuinely unstructured strings.

## 5. Compatibility adapter (`legacy-adapter.ts`)

The only module permitted to inspect strings (emoji prefix, keywords, `🌀`, `💬`, `🤫`, `✨`, `🌋`, `🎉`). It emits normal structured events; explicit structured metadata always wins and never re-enters the adapter. Removal criteria documented in the file header: all 8 stages shipped, no emitter produces control-prefixed strings, and the compatibility `message` text has been retired after at least one full release.

## 6. Transport & persistence

- Bus payload becomes `{ event: GameLogEvent }`; `addLog(string)` remains as an adapter-backed shim during migration.
- `party_combat_log` gains a nullable `event jsonb` column. `message` text stays, unencoded, for at least one full release after stage 8.
- Broadcast payload carries `event` alongside `id` / `message`; receivers prefer `event`, fall back to the adapter.
- `event.id` is generated once and reused across local display, DB row id, broadcast, self-echo dedup and catch-up. Ordering and dedup mechanisms are unchanged.

## 7. Stages

1. **Foundation (behaviour-neutral)** — schema, server map, presentation map, adapter, event-log state, bus/transport carrier, JSONB migration, mixed persistence, tests.
2. Boss telegraphs + cast resolution (drop the `🌀` sentinel from the server).
3. Speech + whispers.
4. Player/enemy attacks.
5. Abilities, crits, procs, DoTs, kills, deaths.
6. Heal, regen, buffs, mitigation, absorb.
7. Debuffs + crowd control (applications, resists, breaks, expiries) as native status events — SHIPPED.
7c. Loot, rewards, XP, levels, quests, contracts — SHIPPED (stage 10).
8. Movement, system, errors and the remaining misc client emitters — SHIPPED (stage 11). Every client emitter now calls a structured builder (`client-event-builder.ts`); `addLog(string)` no longer exists in `src/`. Service-panel mini logs render from the presentation map instead of string colour matching.

Remaining before the legacy adapter can be deleted: retire the compatibility `party_combat_log.message` text (one full release after stage 11) and drop the string fallbacks for historical rows / older-client broadcasts.


## 8. Testing

Per-stage regression: identical telegraph treatment across authored wordings/symbols; fire telegraph ≠ level-up ≠ fire DoT; `✨`/`🌋` inert in structured events; prefix-free speech/whisper routing; `event.id` stable through emit → persist → broadcast → self-echo → catch-up; exhaustive server-type mapping; unknown structured types safe + reported; local vs observer prose without regex; JSONB and text represent the same event; legacy strings still render; unknown legacy strings → neutral; embedded emoji visible; dedup + ordering; both display modes. Plus `tsgo` and Playwright desktop/mobile checks.

## 9. Rollback

Every stage is additive — the `message` string stays on the wire and in the DB, so reverting an emitter restores prior behaviour with no data migration.
