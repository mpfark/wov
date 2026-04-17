

# AI-Suggested Lock Hints

## Overview
Add a ✨ button next to the lock hint Textarea (in both Add and Edit connection forms) that calls the existing `ai-name-suggest` edge function with a new `type: 'lock_hint'`. The AI generates an atmospheric, lore-appropriate hint based on the lock_key item name and the current node's name + description.

## Changes

### 1. Extend `supabase/functions/ai-name-suggest/index.ts`
Add a new branch alongside `region` / `area` / `node`:

```ts
} else if (type === "lock_hint") {
  userPrompt = `Generate an atmospheric in-world hint that a player would discover when searching this location. The hint should subtly point toward where the key item might be found, without revealing it directly.

Locked exit direction: ${context.direction || "unknown"}
Lock requires: "${context.lock_key}" (an item the player must find)
Current location: ${context.node_name || "unknown"}
Location description: ${context.node_description || "(none)"}
Region: ${context.region_name || "unknown"}

The hint should be 1-2 short sentences, atmospheric, and feel like a clue a perceptive adventurer would notice.`;
}
```

Reuse the existing `suggest_name` tool schema — but for `lock_hint` we only need the `description` field. Simplest path: add a second tool `suggest_hint` with a single `hint` property and select it via `tool_choice` when `type === "lock_hint"`. Keep auth, rate-limit, and steward/overlord role check unchanged.

### 2. Add a small `AiSuggestHintButton` component in `NodeEditorPanel.tsx`
Modeled on the existing `AiSuggestNodeButton`. Props: `lockKey`, `direction`, `nodeName`, `nodeDescription`, `regionName`, `onSuggestion(hint)`. Renders a `Sparkles` icon button (loader while pending). Disabled when `lockKey` is empty.

### 3. Wire the button into `ConnectionsManager`
The component already has access to `nodeId` but needs `nodeName`, `nodeDescription`, and `regionName`. Pass these as new props from the parent (the main `NodeEditorPanel` already holds `form.name`, `form.description`, and can resolve region name via `selectedRegionId` + `regions`).

Place the ✨ button:
- **Add form** (around line 336–342): inline with the `Textarea` (flex row), disabled until `addLockKey` is non-empty
- **Edit form** (around line 261–268): same treatment for `editLockHint` / `editLockKey`

On success: populate the corresponding state (`setAddLockHint` / `setEditLockHint`) and toast `"Hint suggested"`.

### 4. Update `ConnectionsManager` props interface
Add `nodeName`, `nodeDescription`, `regionName` to the props and pass them through from `NodeEditorPanel` (single call site, low risk).

## Error handling
Reuse the existing pattern: `toast.error(e.message)` on failure. Surfaces 429/402 messages from the edge function unchanged.

## What stays unchanged
- Existing `region` / `area` / `node` suggestion paths
- Auth, rate limiting (15 req/min/user), role gating
- Lock hint storage format (still optional `lock_hint` field on the connection)
- Player-facing search reveal logic

## Files touched
- `supabase/functions/ai-name-suggest/index.ts` — add `lock_hint` branch + tool
- `src/components/admin/NodeEditorPanel.tsx` — new `AiSuggestHintButton`, pass node context to `ConnectionsManager`, wire button into Add + Edit forms

