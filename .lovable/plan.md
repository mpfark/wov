

## Diagnosis

The naming policy you approved earlier **is already wired into** `supabase/functions/ai-item-forge/index.ts` (lines 122–152 of the system prompt). It governs every *new* generation run.

What was never done: **cleaning up the legacy items** that were generated before the policy. The DB still contains ~131 common/uncommon items with lyrical names that violate the rule:

| Rarity | Violators (approx) |
|---|---|
| common | 68 |
| uncommon | 63 |

Examples: `Mantle of the Obsidian Watch`, `Dawnbreaker`, `Viperfang Dagger`, `Windreaver Warbow`, `Pendant of the Astral Journey`, `Heart of the Ancient Forest`.

So the policy "wasn't put to any effect" because the offenders predate it — not because the prompt is missing the rules.

## Plan: AI-driven legacy rename pass

Add a one-shot **admin-only batch rename tool** that uses the same Gemini AI to rewrite every offending name in line with the policy. No schema changes.

### 1. New edge function: `ai-item-rename`
- Auth: steward/overlord only (same gate as Item Forge).
- Input: optional `dry_run: true` to preview without writing.
- Logic:
  1. Query `items` where `rarity IN ('common','uncommon')` AND name contains `" of "`, `" the "`, or matches the lyrical pattern (`\w+(strike|fang|breaker|reaver|tip|forged|scale|bound|song|bane|edge|fall)`).
  2. Fetch all existing item names for uniqueness check.
  3. Send the offenders to Gemini in batches of 20 with a focused prompt: same naming policy block from the Forge, plus the original `{name, rarity, level, slot, stats}` for each item. Ask for a new compliant name only — keep stats/desc/etc. intact.
  4. Validate each suggestion (no proper nouns, no "of the X", uniqueness vs existing + already-renamed in this batch). Reject and re-roll up to 2x for failures.
  5. `UPDATE items SET name = ... WHERE id = ...` for each accepted rename.
  6. Return `{renamed: N, skipped: [...], preview: [{id, old, new}]}`.

### 2. Admin UI button
- In `src/components/admin/ItemManager.tsx`, add a small "Rename Legacy" button in the toolbar (visible to admins only — the page is already admin-gated).
- On click: confirm dialog → call the function with `dry_run: true` first → show preview list → on confirm, call again with `dry_run: false`.
- Toast result count and reload the items list.

### 3. Out of scope
- Unique / soulforged tier names (their lyrical names are correct).
- Item descriptions (only the name violates the policy).
- The Item Forge prompt itself (already correct — no edit needed).

## Technical detail

- New file: `supabase/functions/ai-item-rename/index.ts` (mirrors `ai-item-forge` structure: auth, rate-limit, role gate, Gemini call via `LOVABLE_API_KEY`).
- Edited file: `src/components/admin/ItemManager.tsx` — single button + confirmation dialog reusing existing shadcn `AlertDialog`.
- No DB migration; uses existing `UPDATE items` policy (`is_steward_or_overlord()` already permits this).
- Uses `google/gemini-2.5-flash` (same as Forge — fast and cheap for ~131 items, ~7 batches).
- Idempotent: re-running it after the first pass will find ~0 violators, so it's safe to repeat.

