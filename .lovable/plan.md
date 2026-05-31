## What's actually wrong

Two separate problems caused by the previous placeholder migration:

1. **The 14 `placeholders/area-type-*.jpg` files are physically gone from storage.** The previous migration renamed the rows in `storage.objects` with a SQL `UPDATE` — but renaming a row in the DB does not move the underlying object in the storage backend. Both the old root path and the new `placeholders/` path now return `404 Not found`. That's why every area / node renders "Image failed to load" and the in-game background is blank.

2. **The `BEFORE INSERT OR UPDATE` trigger silently re-fills `illustration_url`** with the (broken) placeholder URL whenever the field is cleared. So pressing the X to clear, then Save, just writes the placeholder URL back. From the admin's point of view, clearing/removing the illustration looks like a no-op.

Update (real images) works in principle — but if the user uploaded a new file, the URL would point at a freshly uploaded object that does exist. The "can't update" feeling is likely the same trigger story: any half-typed/cleared state gets stomped back to the placeholder URL on save.

## Fix approach

Switch from "store placeholder URL in the row" to "store nothing, fall back in code." This is simpler, makes clearing work, and means broken placeholder URLs never end up in the DB again.

### 1. Database — undo the trigger + placeholder URL writes

New migration:
- `DROP TRIGGER trg_areas_fill_placeholder ON public.areas;`
- `DROP FUNCTION public.areas_fill_placeholder();`
- Keep `public.area_type_placeholder_url(text)` (harmless; used by code/types).
- One-time data scrub on `public.areas`:
  - For every row whose `illustration_metadata->>'is_placeholder' = 'true'`, set `illustration_url = NULL` and strip the `is_placeholder` and `source: area-type-fallback` keys from `illustration_metadata`.
  - This makes the admin URL field correctly show "empty" for placeholder-only areas, so the X button and Save actually clear it.
- The monthly-scene-drain query already treats both `illustration_url IS NULL` and `is_placeholder = true` as "missing", so it keeps working unchanged.

### 2. Frontend — compute the placeholder at render time

`src/features/world/components/LocationBackground.tsx` already does `node → area → region`. Extend the resolver so when all three are empty, it computes a placeholder URL from the area's `area_type` (small helper that mirrors `area_type_placeholder_url`). Result: in-game background still shows a sensible image for areas that haven't been illustrated yet, without ever writing that URL to the DB.

Admin `IllustrationEditor` already shows an inherited URL via `inheritedUrl`; pass the same computed area-type fallback as the lowest-priority inherited URL so the "Effective Background" preview still shows something. The "Local Illustration" / URL field stays empty, so clearing it works.

### 3. Storage — restore the missing placeholder files

The 14 `area-type-*.jpg` files are not in the repo and not in S3 anymore, so they cannot be auto-recovered. Two options for the user — I'll do whichever they pick:

- **A. Re-upload from local.** User drops the 14 original `.jpg` files into a folder; I add a one-shot script that uploads them via the storage API to `background-images/placeholders/area-type-<type>.jpg`.
- **B. Regenerate via AI.** I add a tiny admin button (or one-shot edge function) that uses the existing AI image gateway to generate one neutral placeholder per area type and uploads it to the same paths. Cheaper than waiting for the monthly drain and gives every area type a fallback today.

Without restored files, the in-game fallback will still 404 — the code change in step 2 only matters once the files exist again.

### Out of scope

- No changes to `nodes` (it never had a trigger; named nodes will just inherit the area's effective background, which is the desired behaviour anyway).
- No changes to `area-illustrations` / `node-illustrations` / `item-illustrations` buckets.
- Drain function logic stays as-is.

## Technical notes

- The trigger drop is what unblocks "remove" and "update" in the admin — that's the most important change. Even before placeholder files are restored, the admin will behave correctly.
- After step 1, areas that currently show the broken `placeholders/area-type-*.jpg` URL will go back to "no illustration" in the DB. Until step 3 is done, those areas show no background in-game (same blank state as before the placeholder system existed). That's the same situation as today's broken 404, just cleaner.
- Single migration file; no schema changes beyond dropping the trigger and clearing flagged rows.

## Decision needed

For step 3 — restore the placeholder files via **A) re-upload your local copies**, or **B) AI-regenerate one per area type**?