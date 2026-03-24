

## Ornate Scroll UI for Service Dialogs

### Problem
The Vendor, Blacksmith, and Teleport dialogs use the default shadcn Dialog styling — flat, modern, and out of place in a dark fantasy parchment-themed game.

### Approach
Create a shared `ScrollPanel` wrapper component that replaces the plain `DialogContent` with an ornate scroll aesthetic. All three dialogs get the same decorative frame, differentiated only by header icon and accent color.

### New Component: `src/components/game/ScrollPanel.tsx`

A reusable wrapper that replaces `DialogContent` with:

- **Parchment background** — layered radial gradients over `bg-card` to simulate aged paper
- **Gold filigree border** — double border with inner glow using `box-shadow` (gold-tinted inset shadows)
- **Corner flourishes** — CSS `::before` / `::after` pseudo-elements on corner divs with decorative unicode characters (❧, ❦) or small SVG ornaments in gold
- **Wax-seal close button** — replace the plain X with a circular seal-styled button (dark red circle with embossed X)
- **Ornate header divider** — a centered decorative rule below the title (e.g., `── ✦ ──`)
- **Aged edges** — subtle vignette effect via inset box-shadow darkening the corners

```text
╔══════════════════════════╗
║  ❧                    ❧  ║
║     🪙 Vendor            ║  ← header with icon
║   ─── ✦ ───              ║  ← ornate divider
║                          ║
║   [ content area ]       ║
║                          ║
║  ❧                    ❧  ║
╚══════════════════════════╝
```

### CSS Additions to `src/index.css`

- `.scroll-panel` — the ornate background, border, and shadow styles
- `.scroll-corner` — positioned decorative flourishes
- `.scroll-divider` — the `── ✦ ──` header separator
- `.wax-seal-close` — circular red close button with embossed feel

### File Changes

1. **Create `src/components/game/ScrollPanel.tsx`**
   - Wraps `DialogContent` with ornate styling
   - Props: `icon` (emoji/element), `title` (string), `children`, standard dialog props
   - Renders corner flourishes, ornate divider, and wax-seal close button
   - Applies `scroll-panel` class for the parchment texture

2. **Update `src/index.css`**
   - Add `.scroll-panel`, `.scroll-corner`, `.scroll-divider`, `.wax-seal-close` CSS classes

3. **Update `src/components/game/VendorPanel.tsx`**
   - Replace `<DialogContent>` + `<DialogHeader>` + `<DialogTitle>` with `<ScrollPanel icon="🪙" title="Vendor">`

4. **Update `src/components/game/BlacksmithPanel.tsx`**
   - Replace with `<ScrollPanel icon="🔨" title="Blacksmith">`

5. **Update `src/components/game/TeleportDialog.tsx`**
   - Replace with `<ScrollPanel icon="🌀" title="Teleport">`

### Summary
- 1 new component (`ScrollPanel.tsx`)
- 1 CSS file updated (`index.css`)
- 3 dialog files updated (swap `DialogContent` for `ScrollPanel`)
- No logic changes — purely visual

