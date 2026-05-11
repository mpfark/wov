## Legacy Salvage Cleanup — Final Pass

Audit shows most of the cutover is already complete. Only one real UI change remains; everything else is comment hygiene.

### Audit results

- `characters.salvage` reads in components: **none** (`character.salvage` returns no hits in `src/`)
- `onSalvageChange` / `updateCharacter({ salvage … })`: **none**
- `Character.salvage` field on the type: **already removed** (`useCharacter.ts` only has a comment noting it moved)
- `GamePage.tsx` salvage props to forge panels: **already removed**. Remaining mentions are only in the catch-up rewards toast (`salvage_each` from server payload, plus a comment) — correct, leave as-is.
- `BlacksmithPanel` / `JewelcrafterPanel` / `MaterialsSection` / `GemPouch`: already read salvage + gems via `useMaterials` exclusively.
- `useOwnedGems`: already a thin compatibility wrapper over `useMaterials`.
- `StatusBarsStrip`: still renders a 🔩 salvage chip in the XP line — **needs removal** per spec.

### Changes

**1. `src/features/character/components/StatusBarsStrip.tsx`**
- Remove the `salvageCount` chip block (lines ~414–421) from the XP/RP line.
- Remove the now-unused `const salvageCount = counts.salvage ?? 0;` (line 223). Keep `counts` / `gemCount` (gems chip stays).
- Update the surrounding comment to read "Realtime gem totals from character_materials."
- Salvage now lives only in Equipment → Material Pouch and forge/jewelcrafter UIs.

**2. `src/features/inventory/hooks/useOwnedGems.ts`**
- Strengthen the header comment to the canonical wording:
  ```
  // Transitional compatibility wrapper.
  // Materials ownership now lives in character_materials via useMaterials().
  ```

**3. `src/features/character/hooks/useCharacter.ts`**
- Tighten the existing salvage comment (line ~32) to:
  ```
  // LEGACY: salvage has moved to character_materials (read via useMaterials).
  // The DB column still exists for migration compatibility but is no longer
  // mirrored on this type.
  ```

### Explicitly out of scope (per spec)

- Do **not** drop `characters.salvage` or `character_gems` columns.
- Do **not** remove `useOwnedGems`.
- No balance, forge, gem, or economy logic changes.
- Admin "grant-salvage" tool, `GameManual` text, `salvage_only` loot mode, and `xp.ts` doc-comments stay — they're either backend-grant tooling or documentation about the (still-correct) salvage reward economy.

### Validation

- `rg "character\.salvage|onSalvageChange|salvage:" src/` returns no app-code hits (only `GameManual.tsx` prose).
- StatusBarsStrip shows HP / CP / XP / RP / gems only — no 🔩 chip.
- Material Pouch and Gems pouch in CharacterPanel still show counts and update in realtime on kills.
- Blacksmith and Jewelcrafter still forge, sell, and gem-cut correctly.
- TypeScript clean.
