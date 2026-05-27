Gild the ItemTooltipCard to match the rest of the Dark Fantasy Parchment UI, keeping it clean (no corner glyphs).

### ItemTooltipCard.tsx
- Parchment radial gradient background (lighter, scaled for tooltip size).
- Border: `1.5px solid hsl(var(--gold) / 0.5)`.
- Box shadow: inset dark vignette + soft outer gold glow + drop shadow (mirrors `.scroll-panel-inner` / `.gateway-card`, scaled down).
- Rounded `var(--radius)`, padding `p-3`, `max-w-xs` (unchanged).
- Replace plain `Divider` with `.divider-hairline` (gilded hairline from `index.css`).
- Item name keeps rarity color, adds `text-glow` for non-common rarities.
- Stat rows use existing `t-label` / `t-numeric` classes.

### index.css
- Add `.tooltip-scroll` utility class with the radial parchment gradients, gold-tinted border, and box-shadow stack.

### Tooltip containers (Character, Blacksmith, Jewelcrafter, Stonebinder, InspectPlayerDialog)
- Strip `bg-popover border-border` from their `TooltipContent` className so the new card styling shows through cleanly.

### Out of scope
No changes to tooltip data, comparison logic, durability/value math, or non-item tooltips.