## Goal

Append a short "what you see from here" paragraph to the node description that calls out adjacent nodes worth noticing — named landmarks or anything that offers a service.

## What counts as "worth mentioning"

A connected node is included if **either**:
- It has a non-empty custom `name` (a named landmark, not just inheriting its area's name), **or**
- It has at least one service flag from the registry below.

Hidden connections (`connections[].hidden === true`) are skipped. Locked connections are still mentioned — you can see the building, you just can't enter it yet.

## Streamlined sentence style

One uniform pattern, no special-case phrasing:

```text
To the north‑east stands the Ember Forge (blacksmith, vendor).
To the south‑east stands the Archive of Ages (renown trainer).
To the west lies a teleport circle.
```

Rules:
- Always uses the connection's `direction` field (preserves admin-authored direction labels).
- **Named landmark** → `"To the {dir} stands {Name} ({service list})"`. Service list omitted when there are none.
- **Unnamed but has services** → `"To the {dir} lies {generic service phrase}"` (e.g. "a blacksmith's forge", "a teleport circle", "an inn").
- Multiple destinations in the same direction are listed on separate lines for readability.
- Block is omitted entirely when nothing qualifies.

## Service registry — single source of truth

To answer your second question directly: **yes, future services adopt automatically — but only if you add them to one small registry.** The helper doesn't scan the whole node row blindly (that would pick up unrelated booleans like `is_inn` vs. internal flags), so we centralise the list:

`src/features/world/utils/service-registry.ts`:

```ts
export interface ServiceDef {
  /** Node column / flag — checked for truthiness on the target node. */
  key: keyof GameNode | string;
  /** Short label used inside parentheses after a named landmark. */
  label: string;
  /** Phrase used when the node has no custom name. */
  generic: string;
}

export const SERVICES: ServiceDef[] = [
  { key: 'is_blacksmith',   label: 'blacksmith',     generic: "a blacksmith's forge" },
  { key: 'is_vendor',       label: 'vendor',         generic: 'a vendor stall' },
  { key: 'is_jewelcrafter', label: 'jewelcrafter',   generic: "a jeweler's bench" },
  { key: 'is_trainer',      label: 'renown trainer', generic: "a renown trainer's hall" },
  { key: 'is_inn',          label: 'inn',            generic: 'an inn' },
  { key: 'is_teleport',     label: 'teleport',       generic: 'a teleport circle' },
  { key: 'is_soulforge',    label: 'soulforge',      generic: 'a soulforge' },
  { key: 'is_stonebinder',  label: 'stonebinder',    generic: 'a stonebinder shrine' },
  { key: 'is_heraldry',     label: 'heraldry',       generic: 'a heraldry hall' },
];
// class_hall handled separately: label `"{Class} Order Hall"`.
```

When you add a new service later, you add one row here and it appears in node descriptions, no other code changes. (The icon row in `NodeView.tsx` already enumerates each flag by hand — that's a separate concern and not touched by this change.)

## Where it goes

Inside `NodeView.tsx`, directly under the existing italic description `<p>` (around lines 242–244), as a second `<p>` with slightly dimmer styling so it reads as ambient flavour.

## Technical sketch

New helper `src/features/world/utils/adjacency-description.ts`:

```ts
export function describeAdjacentLandmarks(
  node: GameNode,
  allNodes: GameNode[],
): string[]   // one line per landmark, [] when nothing qualifies
```

Reads the registry above, iterates `node.connections`, resolves targets via `allNodes`, applies the rules, returns sentence lines.

In `NodeView.tsx`:
- Accept `allNodes: GameNode[]` via props (already in `GameContext`).
- Render the lines under the description when non-empty.

In `GamePage.tsx`:
- Pass `nodes` from `useGameContext()` into `NodeView`.

## Out of scope

- No database changes.
- No admin opt-out toggle per node (easy to add later if some landmark should stay hush-hush).
- No creatures / NPCs / players in adjacent nodes — only static landmarks and services.
- The icon strip at the top of the node view is not refactored to share the registry in this pass.
