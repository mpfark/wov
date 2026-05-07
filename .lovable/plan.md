## Goal

Make sure all 1,364 items show up in the Item Pool admin UI (and other item lists hitting the same 1,000-row Supabase ceiling), so "Worn"/"Sturdy" items aren't silently hidden.

## Root cause

Supabase PostgREST caps every `select()` at **1,000 rows by default**. Several admin queries fetch the whole `items` table without pagination, so anything past row 1,000 (when sorted by `level` then `name`) silently disappears from the UI — even though the rows still exist in the database.

## Approach

Add a tiny shared helper that fetches all rows in pages of 1,000 using `.range()`, then use it in the admin views that need the full pool. Keep gameplay/runtime caches unchanged in scope (only fix the admin tools that surface the pool).

### 1. New helper

`src/lib/supabase-paginate.ts`

```ts
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
): Promise<T[]> { /* loops .range(from, to) until a short page returns */ }
```

### 2. Wire into the affected admin queries

- `src/components/admin/loot/ItemPoolTab.tsx` — main fix: replace the single `from('items').select(...).order(...)` with the paginated helper.
- `src/components/admin/ItemCoverageAnalyzer.tsx` — currently `.limit(5000)`; switch to the helper so it can never silently truncate.
- `src/features/inventory/hooks/useItemCache.ts` — module-level item cache used across the app; also paginate so client-side lookups never miss items.

### 3. Leave alone (out of scope)

Other call sites already filter heavily (e.g. `.in('id', itemIds)`, `ilike(...).limit(5)`, count-only queries) and don't realistically exceed 1,000 rows. We can revisit later if needed.

## Verification

- Open `/admin` → Loot → Item Pool, clear filters, confirm the count line shows `1364 items` and Worn/Sturdy items appear.
- Open Item Coverage Analyzer with `common`+`uncommon` enabled, confirm matrices populate for low-level bands.
- Confirm no regression in the player-facing inventory (item names/icons still resolve from `useItemCache`).

## Notes

- No DB / RLS changes.
- No edge-function changes.
- Pure frontend fix; small and contained.
