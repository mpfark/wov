
## Problem

In `NPCDialogPanel.tsx`, the "Ask about" topics render as full-width shadcn `<Button variant="outline">` blocks (lines 137–147). They look like generic UI controls — boxy, bordered, evenly padded — and clash with the Dark Fantasy Parchment theme used everywhere else (italic NPC line, glowing display title).

The contract action buttons (Take / Re-roll / Abandon) have the same issue: standard pill buttons floating inside an in-world parchment panel.

## Proposed direction

Reframe the topic list as **inline dialogue choices** — the way classic CRPGs (Baldur's Gate, Disco Elysium, Pillars) present player options. No button chrome, just numbered/iconic lines of text that glow on hover.

### Topic choices ("Ask about")
- Drop `<Button>` entirely for topics; use a styled `<button>` element.
- Layout: vertical list, each row = `1.` + italic quoted text in `font-display` serif, muted gold color.
- No border, no background. Hover: brighten to `text-primary`, add a subtle `text-glow`, and a left-side `›` chevron that fades in.
- Active topic: solid `text-primary` with the `›` pinned, plus a thin left border accent (`border-l-2 border-primary/60 pl-2`).
- Section header "Ask about" → replace with a small parchment divider (already used elsewhere — a thin rule with a centered ornament/diamond) and label "— speak —".
- "← Back" becomes a small italic `‹ say nothing more` link, right-aligned.

### Contract action buttons
- Keep `<Button>` semantics (they're real actions, not dialogue), but switch to a compact in-world style:
  - `variant="ghost"` + `border border-primary/30 bg-background/40`
  - Smaller text, `font-display`, gold tint.
  - Icons stay (🗡️ / 🔄 / ✖).
- Group them on a single right-aligned row under the spoken line, separated by thin dividers.

### Spoken line block
- Optional polish: add quote glyphs (`"` `"`) flanking the NPC line and shift the NPC name above as a speaker tag (`— Silra Vane —`) to reinforce the dialogue feel.

## Scope

- File touched: `src/features/creatures/components/NPCDialogPanel.tsx` only.
- No logic, state, or RPC changes. Pure presentation.
- Uses existing semantic tokens (`text-primary`, `text-muted-foreground`, `border-primary/*`, `font-display`, `text-glow`) — no hardcoded colors, no new dependencies.

## Open question

Two flavors are possible — want me to pick, or would you like to choose?

1. **Minimal text choices** (recommended): no borders at all, just hover-glow text lines. Most immersive, closest to Disco Elysium.
2. **Parchment scrolls**: each topic sits on a faint parchment strip with a torn-edge look. More decorative, slightly heavier.

If you don't have a preference, I'll go with option 1.
