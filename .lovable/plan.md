# Monthly AI Credit Drain → Node Scene Illustrations

## Goal

On the day before each month change, automatically generate up to **10** scene illustrations for nodes missing `illustration_url`, draining whatever AI credits are still available in the workspace. Stop cleanly on 402 (credits exhausted) or when the cap is hit.

## Caveat (unchanged)

The Lovable AI Gateway has no public "remaining balance" endpoint and no way to scope a request to "free credits only." The job drains whatever pool is active. With cap = 10 at `openai/gpt-image-2` quality `low` (~$0.02–0.04/image), worst case ≈ $0.20–$0.40 per monthly run — comfortably inside the free $1/month most months.

## What gets built

### 1. Storage
- New public `node-illustrations` bucket (mirrors `item-illustrations`).
- Public SELECT policy; service-role write only.

### 2. Schema
- Confirm `nodes.illustration_url` and `nodes.illustration_metadata` exist (they do per current schema — no-op).
- New `ai_credit_drain_log` (run-level): `id`, `run_started_at`, `run_finished_at`, `generated_count`, `cap`, `stop_reason` (`cap_hit` | `credits_exhausted` | `no_targets` | `error`), `notes`.
- New `ai_credit_drain_item_log` (per-node): `id`, `run_id`, `node_id`, `status` (`success` | `error`), `error`, `created_at`.
- Both RLS-locked: overlord-only SELECT, service-role full access.

### 3. Edge function: `monthly-scene-drain`
- `verify_jwt = false`; requires `x-drain-secret` header matching `DRAIN_CRON_SECRET`.
- Hard internal cap = **10**.
- Selects up to 10 nodes where `illustration_url IS NULL OR illustration_url = ''`, joined with their area + region.
- For each node, builds prompt as: `nodes.name + nodes.description` (primary) + area name/description/flavor_text/creature_types (context) + region name/description (mood). Style suffix appended for dark-fantasy parchment consistency.
- Calls `openai/gpt-image-2`, `quality: "low"`, `size: "1024x1024"`, via `LOVABLE_API_KEY`.
- Uploads result to `node-illustrations/{node_id}.png`, updates `nodes.illustration_url` + `illustration_metadata` (model, prompt, generated_at).
- Per-node try/catch: logs to `ai_credit_drain_item_log`. On HTTP 402, stops the loop with `stop_reason = 'credits_exhausted'`.
- Writes one `ai_credit_drain_log` row at the end.

### 4. Scheduler
- Enable `pg_cron` + `pg_net`.
- Job runs daily at 03:00 UTC, but only fires `net.http_post` when `(now() + interval '1 day')::date = date_trunc('month', now() + interval '1 month')::date` (i.e. tomorrow is the 1st).
- Calls the edge function with the `x-drain-secret` header.

### 5. Admin UI
- New "Credit Drain History" card on Admin page showing last 12 runs from `ai_credit_drain_log` (date, count, stop reason).
- No "run now" button (out of scope).

## Out of scope
- Reading literal credit balance (not possible).
- Item / portrait / area / NPC illustrations.
- Shared area-level illustration reuse (each node gets its own unique scene).
- Manual trigger button.
- Cost analytics beyond run-level counts.

## Files
- `supabase/functions/monthly-scene-drain/index.ts` (new)
- DB migration: bucket + policies + 2 log tables
- SQL insert (not migration): `pg_cron` job with project URL + anon key
- `src/pages/AdminPage.tsx` (add card)
- `src/components/admin/CreditDrainHistory.tsx` (new)
- `mem://features/monthly-credit-drain/overview.md` (new memory leaf + index update)

## Secrets needed
- `DRAIN_CRON_SECRET` — random string, shared between the cron job SQL and the edge function. I'll prompt you to add it before deploying.
