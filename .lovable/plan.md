## Goal
Delete files that nothing in the project references, to shrink the repo and reduce noise. Nothing user-visible changes.

## Confirmed unused (verified by repo-wide search)

**Stray images in the project root** (~1.4 MB, zero references)
- `chest_common.png` (791 KB)
- `crown.png` (487 KB)
- `main_hand_uncommon.png` (177 KB)

**Unused paper-doll art** — `src/assets/paper-doll/` (17 PNGs, ~2.6 MB). No file in `src/` or `supabase/` references any of them, and there is no dynamic path building (`paper-doll`, `base_body` appear nowhere in code). This matches the equipment-panel rework that dropped boots/legs slots.

**Unused public assets** (~4.3 MB)
- `public/images/Edhelard_WorldMap.png` (2.7 MB) — not referenced anywhere
- `public/favicon.png` (1.5 MB) — `index.html` only uses `favicon-32.png` / `favicon-64.png`
- `public/favicon.ico` (164 KB) — not referenced
- `public/pwa-512x512.png` — manifest lists only the 192 icon
- `public/placeholder.svg` — Lovable template leftover, unreferenced
- `public/world-export.md` — unreferenced copy of the exported world doc

**Orphaned source files** (no imports anywhere)
- `src/components/admin/AreaManager.tsx`
- `src/components/admin/NodeEditorDialog.tsx`
- `src/components/admin/WorldBuilderPanel.tsx`
- `src/features/inventory/components/ScrollPanel.tsx`
- `src/features/combat/utils/combat-log-utils.ts`

**Lockfile duplicates** — the project uses Bun (`bun.lock`). `package-lock.json` (299 KB) and the legacy binary `bun.lockb` (245 KB) are stale duplicates and can go.

## Deliberately kept
- `src/assets/logo.png` (email templates + auth pages), `src/assets/vitruvian-man.png` (CharacterPanel)
- `public/favicon-32/64.png`, `public/pwa-192x192.png`, `public/manifest.webmanifest`, `public/robots.txt`
- `docs/design/*.md` — design records, harmless and useful

## Technical notes
- Deleting `combat-log-utils.ts` requires removing its entry from `ADAPTER_ALLOWLIST` in `src/features/combat/events/__tests__/no-legacy-log-path.test.ts`; that test fails on stale allowlist entries.
- If `public/favicon.ico` goes, confirm no `<link rel="icon" href="/favicon.ico">` remains in `index.html` (currently none).
- Verification: run the test suite and a production build after deletion; both must pass before the turn ends.
- Everything is a single commit, so the whole purge is revertible from chat history if any asset turns out to be wanted.

## Open question
The 2.7 MB `Edhelard_WorldMap.png` and the paper-doll art look like work-in-progress art you may want later. Say the word and I'll keep either set (or move the large ones to CDN assets instead of deleting).
