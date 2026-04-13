import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function WorldBuilderRulebook() {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 pb-12 space-y-4 max-w-2xl">
        <div>
          <h2 className="font-display text-lg text-primary mb-1">📜 AI Rulebook</h2>
          <p className="text-xs text-muted-foreground">
            Reference of all rules the AI follows when generating world content. These match the system prompt enforced by the <code className="text-[10px] bg-muted px-1 rounded">ai-world-builder</code> edge function.
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            AI Model: <code className="bg-muted px-1 rounded">google/gemini-3-flash-preview</code> · Rate Limit: 10 req / 60s per user
          </p>
        </div>

        {/* World Structure */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">World Structure: Region → Area → Node</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>A <strong>Region</strong> has a name, level range (min/max), description, optional direction, and sort order.</li>
            <li>An <strong>Area</strong> groups nodes by place type and provides a shared name and description. Belongs to a region.</li>
            <li><strong>Nodes</strong> are individual locations within an area. They do NOT need unique names — unnamed nodes display their area name.</li>
            <li>Only give a node its own name if it's a <strong>special/notable location</strong> (inn, vendor, blacksmith, teleport, boss lair, landmark).</li>
          </ul>
        </Card>

        {/* General Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">General Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>All names must use <strong>ASCII-only</strong> characters (A-Z, a-z, spaces, hyphens, apostrophes). No accented/diacritic characters.</li>
            <li>Names are <strong>sanitized server-side</strong>: non-ASCII characters are stripped, temp IDs and flag keywords (e.g. "is_vendor", "true") are removed from names automatically.</li>
            <li>No copyrighted content — original names inspired by high-fantasy, not taken from Tolkien, D&D, etc.</li>
            <li>Directional codes use <strong>short codes only</strong>: N, S, E, W, NE, NW, SE, SW. Never full words.</li>
            <li>Temp IDs (e.g. "node_1", "area_1") must <strong>never</strong> appear in name fields — only in temp_id and reference fields.</li>
          </ul>
        </Card>

        {/* Area Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Area Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Every area must have a <code className="text-[10px] bg-muted px-1 rounded">name</code>, <code className="text-[10px] bg-muted px-1 rounded">description</code>, and <code className="text-[10px] bg-muted px-1 rounded">area_type</code>.</li>
            <li>Valid area types: <Badge variant="outline" className="text-[9px] px-1 py-0">forest</Badge> <Badge variant="outline" className="text-[9px] px-1 py-0">town</Badge> <Badge variant="outline" className="text-[9px] px-1 py-0">cave</Badge> <Badge variant="outline" className="text-[9px] px-1 py-0">ruins</Badge> <Badge variant="outline" className="text-[9px] px-1 py-0">plains</Badge> <Badge variant="outline" className="text-[9px] px-1 py-0">mountain</Badge> <Badge variant="outline" className="text-[9px] px-1 py-0">swamp</Badge> <Badge variant="outline" className="text-[9px] px-1 py-0">desert</Badge> <Badge variant="outline" className="text-[9px] px-1 py-0">coast</Badge> <Badge variant="outline" className="text-[9px] px-1 py-0">dungeon</Badge> <Badge variant="outline" className="text-[9px] px-1 py-0">other</Badge></li>
            <li>Group nodes logically: forest nodes together, town nodes together, etc.</li>
            <li>The area description is shared by all nodes — it should describe the general atmosphere/environment.</li>
            <li>Every node must reference an <code className="text-[10px] bg-muted px-1 rounded">area_temp_id</code>.</li>
            <li>In expand mode, use <code className="text-[10px] bg-muted px-1 rounded">existing_area:&lt;uuid&gt;</code> to assign nodes to an existing area.</li>
          </ul>
        </Card>

        {/* Region Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Region Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Every region must have at least <strong>one inn</strong> node for resting.</li>
            <li>If the region <strong>already has an inn</strong>, the AI will <strong>not</strong> generate another one (checked server-side).</li>
            <li>Regions have a <code className="text-[10px] bg-muted px-1 rounded">min_level</code> and <code className="text-[10px] bg-muted px-1 rounded">max_level</code> range.</li>
            <li>All creature levels within a region must fall within its level range.</li>
          </ul>
        </Card>

        {/* Node Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Node Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Most nodes should have an <strong>empty name</strong> — they inherit the area name.</li>
            <li>Only set a node name for special locations: inns, vendors, blacksmiths, teleports, boss lairs, landmarks.</li>
            <li>Service flags are <strong>separate boolean fields</strong>:
              <code className="text-[10px] bg-muted px-1 rounded ml-1">is_inn</code>,
              <code className="text-[10px] bg-muted px-1 rounded ml-1">is_vendor</code>,
              <code className="text-[10px] bg-muted px-1 rounded ml-1">is_blacksmith</code>,
              <code className="text-[10px] bg-muted px-1 rounded ml-1">is_teleport</code> — never in the name.
            </li>
            <li><code className="text-[10px] bg-muted px-1 rounded">is_teleport</code> is <strong>not generated by AI</strong> — it must be set manually by admins.</li>
            <li>Connections between generated nodes must be <strong>bidirectional</strong> (reverse connections are built automatically on apply).</li>
            <li>In expand mode, use <code className="text-[10px] bg-muted px-1 rounded">existing:&lt;uuid&gt;</code> in <code className="text-[10px] bg-muted px-1 rounded">target_temp_id</code> to reference existing nodes.</li>
            <li>Nodes also support <code className="text-[10px] bg-muted px-1 rounded">searchable_items</code> (JSON array) — managed manually, not by AI.</li>
          </ul>
        </Card>

        {/* Creature Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Creature Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li><strong>1–4 creatures per node</strong>, mix of aggressive and passive.</li>
            <li>Rarity distribution: mostly <Badge variant="outline" className="text-[9px] px-1 py-0">regular</Badge>, a few <Badge variant="secondary" className="text-[9px] px-1 py-0">rare</Badge>, at most 1 <Badge variant="destructive" className="text-[9px] px-1 py-0">boss</Badge> per region.</li>
            <li>Mark <code className="text-[10px] bg-muted px-1 rounded">is_humanoid: true</code> for bandits, soldiers, cultists, mages, knights — anything with a human form.</li>
            <li><strong>Humanoid creatures</strong> automatically receive <strong>gold loot</strong> calculated from level and rarity at creation time (handled in apply logic, not by AI).</li>
          </ul>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Base Stat Formula:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">base = 8 + floor(level × 0.7)</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Per-Attribute Offsets:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">STR = base · DEX = base−1 · CON = base+1 · INT = base−2 · WIS = base−1 · CHA = base−3</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Stat Rarity Multiplier (applied to each attribute):</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">regular = ×1.0 · rare = ×1.3 · boss = ×2.5</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">HP Formula:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">round((15 + level × 8) × multiplier) · regular=1.0 · rare=1.5 · boss=6.0</code>
          </div>
          <div className="text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground text-[11px] mb-0.5">AC Formula:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">round(10 + level × 0.575 + bonus) · regular=+2 · rare=+2 · boss=+6</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Damage Die (base + floor(level × 0.7)):</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">regular base=4 · rare base=6 · boss base=10</code>
          </div>
          <div className="text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Respawn:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">regular=120s · rare=300s · boss=600s</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Examples:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">Lv5 regular: base=11, STR=11, HP=55, AC=15</code>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block mt-0.5">Lv10 boss: base=15, STR=38, HP=570, AC=22</code>
          </div>
        </Card>

        {/* NPC Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">NPC Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li><strong>1–2 NPCs</strong> for inn, vendor, and blacksmith nodes.</li>
            <li>Each NPC has a <code className="text-[10px] bg-muted px-1 rounded">name</code>, <code className="text-[10px] bg-muted px-1 rounded">description</code>, and <code className="text-[10px] bg-muted px-1 rounded">dialogue</code>.</li>
            <li>Dialogue must be lore-appropriate and atmospheric.</li>
            <li>NPC names must not duplicate existing ones when expanding.</li>
          </ul>
        </Card>

        {/* Loot System */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Loot System (Dual-Mode)</h3>
          <p className="text-[11px] text-muted-foreground">
            Creatures use one of two loot modes, set via <code className="text-[10px] bg-muted px-1 rounded">loot_mode</code>:
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li><Badge variant="outline" className="text-[9px] px-1 py-0">legacy_table</Badge> — Manual loot table assignment. Used for <strong>bosses</strong> and special creatures. The AI picks a matching <code className="text-[10px] bg-muted px-1 rounded">loot_table_id</code> from existing tables.</li>
            <li><Badge variant="outline" className="text-[9px] px-1 py-0">item_pool</Badge> — Rule-based drops. Default for <strong>humanoid creatures</strong>. Automatically filters world-drop items by level (creature_level ± offsets) and rarity (80% Common / 20% Uncommon).</li>
            <li><Badge variant="outline" className="text-[9px] px-1 py-0">salvage_only</Badge> — Default for <strong>non-humanoid</strong> creatures (beasts, monsters). No item drops.</li>
          </ul>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4 mt-1">
            <li>Only <strong>boss creatures</strong> should be assigned <code className="text-[10px] bg-muted px-1 rounded">loot_table_id</code> — humanoids use the automatic item pool.</li>
            <li>If no suitable loot table exists, the creature gets <code className="text-[10px] bg-muted px-1 rounded">loot_table_id: null</code> — the AI never invents IDs.</li>
            <li>Loot table IDs are <strong>validated server-side</strong> — any non-existent ID is silently set to null.</li>
            <li>Drop chance: <strong>0.1 – 0.5</strong> — stored as the creature's <code className="text-[10px] bg-muted px-1 rounded">drop_chance</code> field.</li>
            <li>Pool rules (level offsets, rarity weights, consumable chances) are managed via the global <code className="text-[10px] bg-muted px-1 rounded">loot_pool_config</code> table in the Admin Loot Manager.</li>
          </ul>
        </Card>

        {/* Item Forge */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Item Forge</h3>
          <p className="text-[11px] text-muted-foreground">
            Items are created separately from creature/loot generation via the <strong>Item Forge</strong> tab.
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li><Badge variant="outline" className="text-[9px] px-1 py-0">Batch</Badge> — Generate multiple items at once. All saved to <code className="text-[10px] bg-muted px-1 rounded">items</code> with <code className="text-[10px] bg-muted px-1 rounded">world_drop: true</code>.</li>
            <li><Badge variant="outline" className="text-[9px] px-1 py-0">Single</Badge> — Generate one item with full control over slot, level, rarity, and description.</li>
            <li><strong>Duplicate name check</strong>: On save, items with names already in the database are filtered out.</li>
            <li>Item types: <Badge variant="outline" className="text-[9px] px-1 py-0">equipment</Badge>, <Badge variant="outline" className="text-[9px] px-1 py-0">consumable</Badge>. No "material" type.</li>
          </ul>

          <div className="text-[11px] text-muted-foreground mt-2">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Stat Budget Formula:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">equipment: floor(1 + (level−1) × 0.3 × rarity_mult × hands_mult)</code>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block mt-0.5">consumable: equipment_budget × 3</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Rarity Multipliers:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">common = ×1.0 · uncommon = ×1.5 · unique = ×3.0</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Hands Multiplier:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">1-handed = ×1.0 · 2-handed = ×1.5</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Stat Costs (weighted budget):</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">str/dex/con/int/wis/cha = 1pt · ac = 3pts · hp = 0.5pts · hp_regen = 2pts</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Stat Caps (equipment only):</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">Primary stats: 4 + floor(level/4) · AC: 2 + floor(level/10)</code>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block mt-0.5">HP: 6 + floor(level/5)×2 · HP Regen: max 2 · Consumables: no caps</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Gold Value:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">round(level × 2.5 × rarity_mult²)</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Thematic Naming Rules:</p>
            <ul className="text-[10px] space-y-0.5 list-disc pl-4">
              <li><strong>STR</strong>: heavy, iron, war, mighty, brutal, crushing</li>
              <li><strong>DEX</strong>: swift, nimble, agile, shadow, wind, light</li>
              <li><strong>CON</strong>: hardy, enduring, stalwart, fortified, resilient</li>
              <li><strong>INT</strong>: arcane, mystic, scholar, sage, runed, enchanted</li>
              <li><strong>WIS</strong>: wise, oracle, seer, divine, blessed, sacred</li>
              <li><strong>CHA</strong>: charming, noble, regal, commanding</li>
            </ul>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Weapon Tags:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">sword · axe · mace · dagger · bow · staff · wand · shield</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Examples:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">Lv5 common 1h: budget=floor(1+4×0.3×1)=2 → {`{"str":1,"dex":1}`}</code>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block mt-0.5">Lv10 uncommon 2h: budget=floor(1+9×0.3×1.5×1.5)=7 → {`{"str":3,"dex":2,"con":1,"wis":1}`}</code>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block mt-0.5">Lv20 common consumable: budget=floor(1+19×0.3)×3=18 → {`{"hp":18}`}</code>
          </div>
        </Card>

        {/* AI Populate Mode */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">AI Populate Mode</h3>
          <p className="text-[11px] text-muted-foreground mb-1">
            The only AI generation workflow is <strong>Populate</strong>, accessed via the Populate button on the World Map tab. Regions, areas, and nodes are created manually by admins — the AI only populates existing nodes with creatures.
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Select nodes visually on the map, then enter a prompt describing the creatures you want.</li>
            <li>Generates <strong>only creatures</strong> — no new nodes, areas, regions, or NPCs.</li>
            <li>Uses real node UUIDs as <code className="text-[10px] bg-muted px-1 rounded">node_temp_id</code>.</li>
            <li>Creature levels must match each node's region level range.</li>
            <li>Does not duplicate existing creature names on the same node.</li>
            <li>Stats shown in the preview are <strong>recalculated</strong> using <code className="text-[10px] bg-muted px-1 rounded">generateCreatureStats()</code> — the actual values that will be persisted.</li>
          </ul>
        </Card>

        {/* Admin Workflow */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Admin Workflow</h3>
          <p className="text-[11px] text-muted-foreground mb-1">
            World structure is built manually using the map-integrated tools:
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li><strong>Regions</strong> — created via the "New Region" button. Each new region gets an automatic entrance node.</li>
            <li><strong>Nodes</strong> — added using the directional <code className="text-[10px] bg-muted px-1 rounded">+</code> buttons (N, NE, E, SE, S, SW, W, NW) around selected nodes on the map.</li>
            <li><strong>Connections</strong> — click the faint green dotted lines between nearby nodes (&lt;140px) for instant bidirectional linking.</li>
            <li><strong>Areas</strong> — managed via the Areas tab or inline in the Node Editor.</li>
            <li><strong>AI naming</strong> — use the <code className="text-[10px] bg-muted px-1 rounded">✨</code> sparkle button in region/node editors for AI-suggested names and descriptions.</li>
          </ul>
        </Card>

        {/* Server-Side Processing */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Server-Side Processing</h3>
          <p className="text-[11px] text-muted-foreground">
            After the AI generates content, the server applies these transformations before returning the result:
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li><strong>Name sanitization:</strong> Non-ASCII characters stripped. Temp IDs and flag keywords removed from names.</li>
            <li><strong>Loot table validation:</strong> Any <code className="text-[10px] bg-muted px-1 rounded">loot_table_id</code> not matching a real table is set to null.</li>
            <li><strong>Humanoid gold:</strong> On apply, humanoid creatures receive auto-calculated gold loot based on level and rarity.</li>
            <li><strong>Stat recalculation:</strong> On apply, creature stats (HP, AC, attributes) are recalculated using <code className="text-[10px] bg-muted px-1 rounded">generateCreatureStats()</code> to ensure formula accuracy.</li>
            <li><strong>Reverse connections:</strong> On apply, bidirectional connections are built automatically from node connection data.</li>
          </ul>
        </Card>

        {/* What the AI Does NOT Handle */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Not Handled by AI</h3>
          <p className="text-[11px] text-muted-foreground">
            These aspects are managed manually by admins:
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li><strong>Teleport nodes</strong> — set <code className="text-[10px] bg-muted px-1 rounded">is_teleport</code> manually in the Node Editor.</li>
            <li><strong>Searchable items</strong> — configure <code className="text-[10px] bg-muted px-1 rounded">searchable_items</code> per node manually.</li>
            <li><strong>Vendor inventory</strong> — stock is managed via the Vendor Inventory system, not AI generation.</li>
            <li><strong>Items</strong> — created via the Item Forge or Item Manager.</li>
            <li><strong>Loot tables</strong> — created via the Loot Table Manager. AI only assigns existing tables to bosses.</li>
          </ul>
        </Card>
      </div>
    </ScrollArea>
  );
}
