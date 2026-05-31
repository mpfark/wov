## What's there today

In the `background-images` bucket I found 14 `area-type-*.jpg` files sitting in the root (camp, cave, coast, desert, dungeon, forest, hideout, mountain, other, plains, ruins, swamp, town, trail).

In the `areas` table (51 rows):
- 12 areas have real AI illustrations
- 19 areas point at one of these `area-type-*.jpg` placeholders
- 20 areas have no illustration at all

The drain function currently treats any non-null `illustration_url` as "done", so placeholder-using areas are skipped forever.

## Goals

1. Move all `area-type-*.jpg` files into their own folder so they're clearly marked as placeholders.
2. Make every area automatically show its area-type placeholder when it has no real illustration — areas and named nodes alike.
3. Make the monthly scene drain treat a placeholder the same as "missing", so those areas/nodes still get a real generation later.

## Plan

### 1. Storage cleanup
- Copy the 14 `area-type-*.jpg` files from `background-images/` root into `background-images/placeholders/area-type-*.jpg` (same bucket, new prefix — keeps the existing public-read policy).
- Delete the originals from the root after the copy succeeds.

### 2. DB: auto-fill placeholders by area type
- Add a small helper `public.area_type_placeholder_url(area_type)` that returns the new `…/placeholders/area-type-<type>.jpg` URL.
- Add an `area_placeholder` column / flag — simplest: store the placeholder URL in `areas.illustration_url` and mark it in `areas.illustration_metadata` as `{ "is_placeholder": true, "source": "area-type-fallback" }` so we can distinguish it from real art.
- One-time data fix:
  - For the 19 areas currently pointing at the old `…/area-type-<type>.jpg`, rewrite the URL to the new `…/placeholders/area-type-<type>.jpg` path and stamp `illustration_metadata.is_placeholder = true`.
  - For the 20 areas with `NULL` illustration_url, set them to the placeholder for their `area_type` and stamp `is_placeholder = true`.
- Add a trigger on `areas` so that on INSERT, when `illustration_url` is null/empty, it auto-fills with the area-type placeholder and marks `is_placeholder = true`. (Same on UPDATE only if cleared.)

Named nodes are left alone in storage; they don't have area-type placeholders today, and the existing fallback chain in `LocationBackground` (`node → area → region`) means an unnamed/illustration-less node will already render its parent area's placeholder.

### 3. Drain function update
Update `supabase/functions/monthly-scene-drain/index.ts` so the "missing illustration" filter for both areas and named nodes also catches placeholders:

```
illustration_url IS NULL
  OR illustration_url = ''
  OR illustration_metadata->>'is_placeholder' = 'true'
```

When the drain saves a real illustration, it already overwrites `illustration_metadata` with the generation info (no `is_placeholder` flag), so the area/node automatically drops out of the "missing" set afterwards.

The hard cap of 10 per run and the area-first / named-node-second ordering stay exactly as they are.

## Technical details

- Storage move is done via the storage REST API from a one-shot migration/script using the service role key — copy then delete each of the 14 objects. Public URL stays on the same bucket; only the path changes.
- New URL pattern: `https://<ref>.supabase.co/storage/v1/object/public/background-images/placeholders/area-type-<type>.jpg` (note: today's stored URLs have a double slash `/background-images//area-type-…` — the rewrite will also clean that up).
- The `is_placeholder` flag lives in `illustration_metadata` (already a `jsonb` column on `areas`), so no schema change needed beyond the trigger + helper function.
- Frontend `LocationBackground.tsx` needs no changes — it just reads `illustration_url`.
- Admin UI that uploads a real area illustration should clear the placeholder flag; if there's such a code path, I'll make sure it overwrites `illustration_metadata` (it likely already does).

## Out of scope

- Renaming or reorganising `node-illustrations` / `item-illustrations` / `area-illustrations` buckets.
- Generating any new artwork — that's still the drain's job on its next run.
