## Goal

Add a **Jewelcrafter** service that mirrors the Blacksmith but only forges **rings, amulets, and trinkets** (the slots removed from the Blacksmith earlier).

## What gets added

### 1. Database (migration)
- Add `is_jewelcrafter boolean NOT NULL DEFAULT false` to `nodes`.
- No enum change needed for `npcs.service_role` (it's free text). New value: `'jewelcrafter'`.

### 2. New edge function `jewelcrafter-forge`
Copy of `blacksmith-forge` with:
- `ALL_SLOTS = ["ring", "amulet", "trinket"]`
- Node check: `node.is_jewelcrafter` instead of `is_blacksmith`.
- Same cost formula (`salvage = 5 + level*2`, `gold = level*5`) and same common-rarity, ±2 then ±5 level fallback pool.

### 3. New `JewelcrafterPanel`
A trimmed copy of `BlacksmithPanel` with:
- Tabs: **Repair** (rings/amulets/trinkets only) and **Forge**.
- No Soulforge tab.
- `FORGE_SLOTS` limited to ring / amulet / trinket.
- Calls `jewelcrafter-forge` instead of `blacksmith-forge`.
- Repair tab filters inventory to those three slots (so the smith and jeweler don't overlap repair-wise — see open question below).

### 4. Admin: `NodeEditorPanel`
- New checkbox `💎 Is Jewelcrafter (forge rings, amulets, trinkets)`.
- Add `is_jewelcrafter` to form state, load, save, and create-paths.
- Add `'jewelcrafter'` to the service-NPC role list with label "Jeweler".
- Flag chip for Jewelcrafter.

### 5. Admin world map + game UI
- `AdminWorldMapView`, `NodeView`, `MapPanel`, `PlayerGraphView`: show a 💎 icon when `is_jewelcrafter` is set, mirroring the blacksmith 🔨 treatment (staffed glow when a `jewelcrafter` NPC is present).
- `NodeView` NPC icons/labels: `'jewelcrafter' → 💎 / Jeweler`.

### 6. `GamePage`
- `jewelcrafterOpen` state, mount `<JewelcrafterPanel>` when `currentNode.is_jewelcrafter`.
- Talk routing: NPC with `service_role === 'jewelcrafter'` opens the jeweler panel (mirrors blacksmith routing).
- Action menu: `onOpenJewelcrafter` when on a jewelcrafter node.

### 7. `ai-generate-service-npc` + `ai-name-suggest`
- Accept `'jewelcrafter'` role with a fitting prompt persona ("a refined jeweler / lapidary").

### 8. Memory
- Update `mem://style/ui-layout/service-panels` note (or add a sibling) noting Jewelcrafter shares the ServicePanelShell pattern.

## Technical details

```text
nodes
 ├── is_blacksmith     → main_hand, off_hand, head, chest, shoulders,
 │                       gloves, belt, pants, boots
 └── is_jewelcrafter   → ring, amulet, trinket   (NEW)
```

Both flags are independent — a node can be one, the other, both, or neither. Soulforge stays tied to Blacksmith only.

## Open question

Repair scope: should the **Jewelcrafter also repair** rings/amulets/trinkets (and the Blacksmith stop repairing them), or should the Blacksmith continue to repair everything while only forging is split? Default in this plan: **Jewelcrafter repairs only jewelry; Blacksmith repairs everything else**, but say the word and I'll switch to "Blacksmith repairs all, Jewelcrafter only forges".