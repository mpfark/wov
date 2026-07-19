# Overlord Combat Audit Log

An overlord can flip a "trace" flag on any character. While traced, every combat event that character emits is persisted to a durable audit table. A new tab in **Admin → Tools** lets the overlord pick a traced character and read their combat log. A prune job keeps the table at ~20,000 rows globally.

## What gets built

### 1. Schema (`combat_audit_log` + trace flag)

- Add `characters.combat_trace_enabled BOOLEAN NOT NULL DEFAULT false`.
- New table `public.combat_audit_log`:
  - `id BIGSERIAL PK`
  - `created_at TIMESTAMPTZ DEFAULT now()`
  - `character_id UUID` (indexed, FK → characters, ON DELETE CASCADE)
  - `character_name TEXT` (denormalized so log survives if character renamed)
  - `node_id UUID NULL`
  - `event_type TEXT` (attack, ability, dot_tick, kill, buff, cast, etc.)
  - `message TEXT` (the same formatted line the player sees)
  - `payload JSONB NULL` (raw structured event for deep audit)
- Indexes: `(character_id, created_at DESC)`, `(created_at)` for prune.
- GRANTs: `SELECT` to `authenticated` (RLS restricts to overlord); `ALL` to `service_role`.
- RLS: `SELECT` policy `has_role(auth.uid(), 'overlord')`; no client insert/update/delete.

### 2. Server-side write path

- In `combat-tick` (and `combat-catchup`), after building the per-character formatted event lines, check a small in-memory cache of traced character ids (refreshed each invocation from `characters` where `combat_trace_enabled = true`). For each traced character, insert its events into `combat_audit_log` in one batched insert per tick.
- Writes use the service-role client already present in the function.
- No-op when no traced characters exist (single `SELECT` returns empty).

### 3. Prune

- pg_cron job `combat_audit_prune`, hourly, gated by `world_is_awake()`:
  ```sql
  DELETE FROM public.combat_audit_log
  WHERE id IN (
    SELECT id FROM public.combat_audit_log
    ORDER BY id DESC OFFSET 20000
  );
  ```
- Fast because of the descending id index; only runs when there's activity.

### 4. Admin UI

- New `CombatAuditPanel` under `src/components/admin/tools/`.
- Registered in `ToolsPanel.tsx` as a new entry `{ key: 'combat-audit', label: 'Combat Audit', icon: ScrollText }`.
- Only visible to overlord (existing `useRole().isValar` gate on the Tools tab entry).
- UI:
  - Left column: list of characters with `combat_trace_enabled = true` + a search-to-add control (pick any character, toggle trace on/off).
  - Right column: virtualized list of the selected character's `combat_audit_log` rows, newest first, with node id, event type, message. Filter by event_type. "Refresh" button + optional realtime subscription on `combat_audit_log` filtered by character_id.
  - Footer shows current row count vs 20,000 cap.

### 5. Toggle RPC

- `set_character_combat_trace(_character_id uuid, _enabled boolean)` SECURITY DEFINER, checks `has_role(auth.uid(), 'overlord')`, updates the flag. Client calls this from the panel.

## Technical notes

- Trace check in the edge function is a single query per invocation returning a `Set<uuid>`; negligible cost when empty.
- We reuse the exact formatted string built by `interpretCombatTickResult` logic on the server side (server already formats events before returning them), so audit log matches what the player sees.
- Denormalizing `character_name` avoids joining `characters` for display and keeps the log intact after deletes (cascade removes rows anyway; the name is useful for exports).
- 20k rows at ~200 bytes each ≈ 4 MB — well within budget.
- Cron gated by `world_is_awake()` so the sleep-optimization work isn't undone.

## Out of scope

- No global "audit everyone" mode (per your choice: opt-in only).
- No export/download button in v1 (can add later; overlord can query directly).
- No edits to how the player's live Event Log renders.
