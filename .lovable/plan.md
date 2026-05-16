
# Typography & UI Rhythm Pass — Plan

Goal: keep the dark fantasy / MUD identity, but give the UI one shared type scale, one spacing rhythm, and a smaller set of "text modes" so the eye can parse panels faster. No redesign, no Event Log rework.

## 1. Audit findings (what's actually causing the noise)

A quick sweep of the codebase shows the root causes:

- **Too many one-off sizes.** ~780 hits of arbitrary `text-[10px] / [11px] / [12px] / [13px]` across components. Sizes drift per panel.
- **Too many "label modes."** Headers freely mix `font-display + uppercase + tracking-wide(r/est)`, gold/teal/muted variants, italics, and `text-glow`. Each panel reinvents its own header treatment (Character, Inventory, Service panels, Admin all differ).
- **Spacing is local, not systemic.** `space-y-1`, `space-y-1.5`, `space-y-2`, `gap-1`, `gap-1.5`, `py-1.5`, `py-2`, `my-1.5` all appear next to each other inside the same panel. There is no defined "row / group / section" rhythm.
- **Opacity used as a color.** `text-muted-foreground/80`, `/70`, `/60`, plain `opacity-50/60/70/80` are scattered; metadata vs disabled vs "dim" isn't differentiated.
- **Numeric emphasis is inconsistent.** Stats, costs, durability, HP/CP/MP all render in body weight + base color. The Event Log just got dedicated `log-number-*` tokens — nothing else has equivalents.
- **Tooltips are flat.** `ItemTooltipCard` puts identity, stats, metadata, flavor at near-equal weight; only rarity color separates them.
- **Interaction states.** Tabs/buttons rely on default shadcn variants; selected tab vs hovered tab vs disabled action aren't visually ranked.

The Event Log pass already established the right pattern (semantic tokens + structured spans). This plan extends that pattern outward — it does not touch the Event Log.

## 2. Proposed systems

### 2a. Type scale (5 roles, not 15 sizes)

| Role | Class preset | Use |
|---|---|---|
| `display-lg` | `font-display text-base tracking-wide text-primary text-glow` | Panel/page title (one per panel) |
| `display-sm` | `font-display text-sm tracking-wide text-primary` | Section headers inside a panel |
| `label` | `font-display text-[11px] uppercase tracking-[0.14em] text-muted-foreground` | Metadata labels, tab labels, group captions |
| `body` | `text-sm leading-snug text-foreground` | Default readable prose, descriptions, log lines |
| `meta` | `text-xs leading-snug text-muted-foreground` | Secondary info, timestamps, counts |
| `numeric` | `font-display tabular-nums text-foreground` (size inherits) | Any displayed number (stats, gold, HP, durability) |

Rules:
- Only `display-lg` may use `text-glow`. Stops the "everything glows" effect.
- `uppercase + tracking` reserved for `label`. No uppercase body text, no uppercase section headers.
- `italic` reserved for flavor text in tooltips and combat narrative lines. Nowhere else.
- `tabular-nums` always on numeric values so columns of stats line up.

### 2b. Spacing rhythm (4 levels)

Replace ad-hoc spacing with semantic gap classes:

| Token | Value | Use |
|---|---|---|
| `gap-row` | `space-y-1` (4px) | Items inside a tightly grouped list (stats row, log line) |
| `gap-group` | `space-y-2` (8px) | Between groups inside a section (identity / stats / flavor) |
| `gap-section` | `space-y-4` (16px) | Between sections inside a panel |
| `gap-panel` | `space-y-6` (24px) | Between top-level panel blocks |

Panel padding standardizes to `p-3` (compact panels: inventory, character) and `p-4` (service panels). Divider style standardizes to `h-px bg-border/60`.

### 2c. Opacity hierarchy (stop using % as a color)

Replace mixed `/60 /70 /80` with three tiers using existing tokens:

- **Primary text** — `text-foreground` (full).
- **Metadata** — `text-muted-foreground` (~55% luminance vs bg; already defined).
- **Disabled / passive** — `opacity-60` only, applied to the whole interactive element, never to text alone.

### 2d. Numeric emphasis tokens (mirror what Event Log did)

Add semantic `ui-number-*` tokens in `index.css` + `tailwind.config.ts`:
- `ui-number` — neutral large number (stat value, gold count).
- `ui-number-pos` — gains (+1 STR diff, heal).
- `ui-number-neg` — losses, broken durability.
- `ui-number-cap` — "of max" (e.g. `42 / 60` — the `/ 60` is dimmed).

Always pair with `tabular-nums`.

### 2e. Tooltip hierarchy (item tooltip card)

Restructure into 4 visually-ranked blocks separated by `gap-group`:
1. **Identity** — rarity-colored name (display-sm), subtitle as `label`, level as `meta`.
2. **Stats** — two-column grid, label left (`label`), value right (`numeric`, sign-colored).
3. **Metadata** — durability bar, weight, value as `meta` row.
4. **Flavor** — italic, `meta` color, top border separator.

### 2f. Interaction clarity

- **Tabs**: selected = `text-primary` + 1px bottom border `border-gold/70`; hover = `text-foreground`; idle = `text-muted-foreground`. Drop background fills.
- **Buttons**: keep current variants; only add `font-display tracking-wide` to primary CTAs so they read as "action" without extra glow.
- **Clickable text in panels** (item names in lists, etc.) gets a single `hover:text-primary transition-colors` rule instead of varying treatments.

## 3. Implementation plan (low → high risk, phased)

### Phase 1 — Foundations (low risk, no visual jump)
1. Add tokens to `src/index.css` (`--ui-number-*`) and `tailwind.config.ts` (`colors.ui.*`).
2. Create `src/styles/typography.css` (or extend `index.css`) with utility classes: `.t-display-lg`, `.t-display-sm`, `.t-label`, `.t-body`, `.t-meta`, `.t-numeric`. These are documented presets, not magic — components can still use raw Tailwind.
3. Add a short `src/features/README.md` section "Typography & rhythm" describing the 5 roles + 4 gap tokens.

Risk: none — purely additive.

### Phase 2 — Tooltip card (high visibility, contained scope)
4. Refactor `src/components/items/ItemTooltipCard.tsx` to the 4-block hierarchy above. This is the most-seen surface and the clearest "before/after".

Risk: low — single file, no logic changes.

### Phase 3 — Character + Inventory panels (the densest panels)
5. `src/features/character/components/CharacterPanel.tsx`, `StatusBarsStrip.tsx`, `PortraitTab.tsx`: replace ad-hoc text sizes with role classes, normalize spacing to the 4 gap tokens, apply `tabular-nums` to all numeric displays.
6. `src/features/inventory/components/*Panel.tsx` + `MaterialsSection`, `GemPouch`: same treatment, plus tab styling pass.

Risk: medium — touches many files but mechanical (find/replace patterns + visual QA per panel).

### Phase 4 — Service panels (Vendor / Blacksmith / Jewelcrafter / Stonebinder / Trainer / Scroll / Soulforge)
7. Standardize `ServicePanelShell` header/tab typography to `display-lg` + `label`.
8. Apply role classes inside each service panel body.

Risk: medium — many files, but they all share `ServicePanelShell` so the header pass is one edit.

### Phase 5 — Admin pages
9. Apply role classes to `AdminPageShell`, `AdminEditorHeader`, `AdminToolSection`. Admin is internal-only so this is last.

Risk: low — internal surface, can iterate freely.

### Phase 6 — Cleanup
10. Add a small ESLint rule or grep-CI check that flags new `text-[NNpx]` literals so we don't regress.
11. Remove now-unused glow / uppercase / italic clusters identified during the pass.

Risk: low.

## 4. Explicitly out of scope

- Event Log styling (already overhauled).
- Combat text wording / flavor.
- Colors of rarity, class, faction, gem.
- Fonts (`Cinzel` + `Crimson Text` stay).
- Layout structure of any panel.
- Animations.

## 5. What you'll see after Phase 1+2

The tooltip card switches to the new hierarchy and the foundation is in place; everything else still looks identical. From there each subsequent phase is an independently shippable PR-sized change you can approve panel-by-panel, so the rollout is gradual and reversible — no "big bang" rewrite.

## 6. Technical notes

- All new color tokens go through `hsl(var(--...))` in `tailwind.config.ts`, matching existing convention.
- Role classes are plain CSS utility composites in `index.css` `@layer components` — no new dependency, no CSS-in-JS.
- `tabular-nums` is a CSS feature, no font change required (both Cinzel and Crimson Text expose it).
- The Event Log's `event-log-*` classes stay as-is; the new `t-*` classes coexist.
