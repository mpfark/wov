# NPC Dialogue Topics System

Upgrade NPCs from a single greeting blob to a **greeting + branching topic menu**. Each topic is a button the player can click to ask about something specific. The system is data-driven so admins can author dialogue without code, and the same structure will later carry quests, rumors, and lore.

## Data model

Add a `dialogue_topics` JSONB column to `npcs` (the existing `dialogue` column stays as the greeting). Each topic is an object:

```jsonc
{
  "id": "templar_hall",          // stable key
  "label": "Where is the Templar Hall?",  // button text the player sees
  "response": "Head east past the river, then north at the old shrine.",
  "kind": "text",                // text | class_hall_dir | quest_hook (future)
  "params": { "class": "templar" }, // optional, used by dynamic kinds
  "requires": { /* future: quest flags, bond level, class, etc. */ },
  "follow_up": []                // future: nested topics
}
```

`kind` lets us mix hand-written answers with **dynamic** ones the engine resolves at runtime. Phase 1 ships two kinds:

- `text` — static `response` string (fully admin-authored).
- `class_hall_dir` — engine looks up the node tagged `class_hall = params.class`, computes the compass direction from the NPC's node, and renders a sentence like *"The Templar Hall lies to the north-east, in the Verdant Marches."* Admin only picks the class; no manual upkeep when halls move.

A small built-in helper topic `kind: "class_hall_menu"` expands into one auto-button per known order hall — so a recruiter or innkeeper can offer "Tell me about the orders" without listing seven topics by hand.

## Admin authoring (NPC Manager)

In the NPC editor, below the existing Dialogue field, add a **Topics** section:

- List of topic rows with drag-to-reorder.
- Each row: Label input, Kind dropdown (Text / Class Hall Directions / Class Hall Menu), and a Response textarea or a Class picker depending on kind.
- "Add topic" button; trash icon to remove.
- Stored as the `dialogue_topics` JSONB array on save.

No migration of existing NPCs needed — empty array means "no topics, behaves exactly like today."

## Player UX (NPCDialogPanel)

Rework the dialog so it always shows:

1. NPC name + description (unchanged).
2. The current spoken line in the parchment box — starts as `npc.dialogue` (greeting).
3. Below it, a vertical list of topic buttons built from `dialogue_topics`.
4. Clicking a topic replaces the spoken line with that topic's resolved response and keeps the menu visible so the player can ask more.
5. A "Back" affordance returns to the greeting.

Service-role NPCs (recruiter, vendor, etc.) keep their primary action button; topics render alongside it, so a Templar recruiter can both enlist you AND answer "where is the Wizard Hall?".

## Direction resolver (shared util)

New pure helper `src/features/world/utils/directions.ts`:

- Input: from-node, to-node, regions, areas.
- Output: `{ compass: 'north-east', distance: 'nearby' | 'far', region_name, area_name }` using the existing `x/y` grid already used by the world map.
- Used by `class_hall_dir` and reusable for future "where is the marketplace?" topics.

Resolution happens client-side using already-loaded `useNodes` data — no extra DB calls.

## Forward compatibility (no code yet, just shape)

The same `dialogue_topics` schema is intentionally enough to host:

- **Quest hooks** — `kind: "quest_offer"`, `params: { quest_id }`, gated by `requires`.
- **Rumors** — `kind: "text"` with `requires: { min_level: 10 }` so they appear only when relevant.
- **Conditional lore** — `requires: { has_item, class, bond_gte }`.

Phase 1 ignores `requires` and `follow_up`; they're reserved keys so we can add them later without another migration.

## Rollout

1. Migration: add `dialogue_topics jsonb not null default '[]'` to `npcs`.
2. Types regen.
3. NPC Manager: topic editor UI.
4. Shared `directions.ts` helper + small unit test.
5. NPCDialogPanel: greeting + topic buttons + resolver for `text` / `class_hall_dir` / `class_hall_menu`.
6. OrderRecruiterDialog: render the same topic list under the existing Join/Switch controls so recruiters can also give directions to other halls.
7. Seed a few example topics on Knut so you can try it immediately.

## Technical notes

- Resolver is a pure function; kinds are dispatched through a small `topicResolvers` map so adding a new kind later is one entry.
- All compass/direction strings come from the existing world-geography conventions to stay consistent with movement keys.
- No new RLS needed — topics live inside `npcs`, which already has policies.

Approve and I'll implement.
