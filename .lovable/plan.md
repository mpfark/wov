## Problem

`BlacksmithPanel` always calls `useSoulforgeForge` (hooks must be unconditional) and, when `character` is missing, passes a placeholder:

```ts
character: (character ?? ({ id: '', level: 0, gender: 'male' } as Character))
```

With `level: 0`, the hook evaluates `isNotWorthy = level < 40` → true and returns the "not worthy" branch. Today the parent gates display with `tab === 'soulforge' && showSoulforge && character`, so the placeholder output is never rendered — but the hook still:

1. Builds a full "not worthy" slot tree for a fake character.
2. The instant a real `character` arrives, the hook switches branch (not worthy → mode pick / active forge), changing slot identity. Combined with the gate flipping from `!character` to `character`, the Soulforge tab can briefly render nothing then snap into the real UI → flicker.
3. If `isSoulforgeNode` is true while `character` is momentarily undefined, the Soulforge tab is selectable but yields a blank panel (the gate falls through to the Repair branch), which can also flicker when the character arrives.

## Fix

Make the hook explicitly aware that it may be called with no real character, and have it return a stable "loading" slot tree in that case. Then have the parent always trust `sf.*` for the Soulforge tab without a separate `character` gate.

### Changes

**1. `src/features/inventory/components/SoulforgeTabContent.tsx`**

- Change the option type to allow `character: Character | null`.
- At the top of the hook (before any branch logic, after all hooks are declared), add:
  ```ts
  if (!character || !character.id || character.level <= 0) {
    const loading = (
      <ServicePanelEmpty>Awaiting the wayfarer's arrival…</ServicePanelEmpty>
    );
    return { left: loading, right: null, footer: null, leftTitle: "The Soulwright's Anvil" };
  }
  ```
  This branch is taken only for the placeholder/unloaded case and produces a stable, neutral UI — never the misleading "not worthy" message.
- Keep all `useState` / `useMemo` calls above this guard so hook order stays stable.
- Derived booleans (`canCrown`, `canSoulforge`, `isNotWorthy`, `allDone`) and the rest of the existing branches are unchanged for real characters.

**2. `src/features/inventory/components/BlacksmithPanel.tsx`**

- Pass `character ?? null` to the hook instead of constructing a fake `{ id: '', level: 0 }` object:
  ```ts
  const sf = useSoulforgeForge({
    character: character ?? null,
    onForged: () => { onInventoryChange(); },
  });
  ```
- Drop the `&& character` part of the Soulforge tab gate so the hook's own loading slot is shown when needed:
  ```ts
  if (tab === 'soulforge' && showSoulforge) { ... use sf.* ... }
  ```
- Keep `showSoulforge` (driven by `isSoulforgeNode`) as the single source of truth for whether the Soulforge tab is visible at all.

### Why this prevents flicker / wrong UI

- The hook never returns the "not worthy" branch for a phantom level-0 placeholder.
- The Soulforge tab always has a stable slot tree (loading → real UI), so the persistent `ServicePanelShell` swaps its `left/right/footer` content in place without any hidden gate toggling on/off.
- Hook order remains stable because the new guard runs after all `useState` / `useMemo` calls.

### Files touched

- `src/features/inventory/components/SoulforgeTabContent.tsx` — accept nullable character, add early "loading" return guard.
- `src/features/inventory/components/BlacksmithPanel.tsx` — pass real-or-null character, simplify Soulforge tab gate.

No DB, edge function, or auth changes.
