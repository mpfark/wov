## Item Coverage Analyzer

A new admin panel that audits the existing item pool and surfaces gaps — especially for uniques — by class, stat, slot, and level band. Read-only: it analyzes and recommends, never creates items.

### Where it lives

- New admin tab **"Item Coverage"** registered in `src/components/admin/AdminSidebar.tsx` and routed in `src/pages/AdminPage.tsx`.
- New component `src/components/admin/ItemCoverageAnalyzer.tsx`.
- Pure analysis utilities in `src/components/admin/coverage/` so logic is testable independent of UI:
  - `coverage-types.ts` — types for `CoverageCell`, `Gap`, `Recommendation`.
  - `coverage-analyzer.ts` — takes raw items + class/stat metadata and returns a coverage report.
  - `coverage-recommendations.ts` — turns gaps into prioritized "Suggested Next Items".

### Data inputs

- `items` table: rarity, level, slot, stats, weapon_tag, hands, item_type.
- Class metadata from `src/shared/formulas/classes.ts`:
  - `CLASS_LABELS` — class list
  - `CLASS_LEVEL_BONUSES` — primary/secondary stats per class
  - `CLASS_WEAPON_AFFINITY` — preferred weapon tags
- Level cap from progression memory (L42).

Filter to `world_drop = true` items by default (with a toggle to include all).

### Level bands

Every 5 levels: 1–5, 6–10, 11–15, 16–20, 21–25, 26–30, 31–35, 36–40, 41–42.

### Class-fit heuristic

An item "fits" a class when ANY of these are true:
- Its dominant stat is one of the class's `CLASS_LEVEL_BONUSES` keys.
- It is a weapon whose `weapon_tag` is in the class's `CLASS_WEAPON_AFFINITY`.
- It is a non-stat-based slot (hp/hp_regen-only consumable etc.) — counted as "neutral", not class-specific.

### Status thresholds (per class × band × rarity)

- **good**: ≥ 3 fitting items
- **weak**: 1–2 fitting items
- **missing**: 0 fitting items
- For uniques specifically: **missing** if 0, **weak** if 1, **good** if ≥ 2.

### UI sections

1. **Filters bar** — rarity multi-select (default unique), include consumables toggle, world-drop toggle.
2. **Class × Level-band Coverage Matrix** — rows = 7 classes, columns = 9 bands, cells colored good/weak/missing with item count. Click a cell → side drawer listing items + gaps.
3. **Stat Coverage** — STR/DEX/CON/INT/WIS/CHA × bands; counts items where stat is dominant.
4. **Slot Coverage** — slot × bands matrix.
5. **Unique Gaps** (most prominent) — sorted list of band/class/slot combos with zero unique support, e.g. "Level 31–35 · Wizard · no INT-focused weapon".
6. **Suggested Next Items** — prioritized list generated from gaps, format:
   - "Create level 35 INT staff unique for Wizard"
   - "Create level 30 WIS/CON shield unique for Templar"
   Priority = (rarity weight: unique=3, uncommon=1) × (class-coverage deficit) × (band importance, mid/late game weighted higher).

### Technical notes

- All analysis happens client-side from a single `supabase.from('items').select(...)` query — fast enough for ~1400 items.
- Memoize the coverage report with `useMemo` keyed on filters + raw items.
- Color tokens: use existing semantic tokens (`destructive` for missing, `warning`/`accent` for weak, `primary` for good) — no hardcoded colors.
- Tooltips on each matrix cell list contributing item names.
- Add a small unit test file `coverage-analyzer.test.ts` covering: empty pool, single-item pool, class-fit by stat, class-fit by weapon tag, threshold edges.

### Out of scope (per request)

- No item creation or auto-forge integration. The recommendations are text-only; a future iteration could add "Send to AI Item Forge" buttons.
