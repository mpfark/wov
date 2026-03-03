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
            <p className="font-medium text-foreground text-[11px] mb-0.5">Base Stats (str, dex, con, int, wis, cha):</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">round(10 + level × 0.7) · Bosses: ×2.0</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">HP Formula:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">round((15 + level × 8) × multiplier) · regular=1.0 · rare=1.5 · boss=4.0</code>
          </div>
          <div className="text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground text-[11px] mb-0.5">AC Formula:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">round(10 + level × 0.6 + bonus) · regular=+2 · rare=+2 · boss=+6</code>
          </div>
          <div className="text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Respawn:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">regular=120s · rare=300s · boss=600s</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Examples:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">Lv5 regular: stats=14 each, HP=55, AC=15</code>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block mt-0.5">Lv10 boss: stats=34 each, HP=380, AC=22</code>
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

        {/* Loot Table Assignment Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Loot Table Assignment</h3>
          <p className="text-[11px] text-muted-foreground">
            The AI does <strong>not</strong> generate items. Items are created separately via the <strong>Item Forge</strong>. Instead, the AI assigns existing loot tables to creatures.
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Only <strong>humanoid creatures</strong> (<code className="text-[10px] bg-muted px-1 rounded">is_humanoid: true</code>) should be assigned loot tables.</li>
            <li>Non-humanoid creatures (beasts, monsters) get <code className="text-[10px] bg-muted px-1 rounded">loot_table_id: null</code>.</li>
            <li>The AI picks a loot table whose <strong>item levels are within ±3 levels</strong> of the creature's level.</li>
            <li>Item rarities in the table should match the creature: <Badge variant="outline" className="text-[9px] px-1 py-0">common</Badge> / <Badge variant="outline" className="text-[9px] px-1 py-0">uncommon</Badge> for regular creatures, up to <Badge variant="secondary" className="text-[9px] px-1 py-0">rare</Badge> for rare/boss.</li>
            <li>If no suitable loot table exists, the creature gets <code className="text-[10px] bg-muted px-1 rounded">loot_table_id: null</code> — the AI never invents IDs.</li>
            <li>Loot table IDs are <strong>validated server-side</strong> — any non-existent ID is silently set to null.</li>
            <li>Drop chance: <strong>0.1 – 0.5</strong> — stored as the creature's <code className="text-[10px] bg-muted px-1 rounded">drop_chance</code> field.</li>
          </ul>
        </Card>

        {/* Generation Modes */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Generation Modes</h3>
          <p className="text-[11px] text-muted-foreground mb-1">
            The AI world builder supports three modes, plus a map-integrated populate workflow:
          </p>
          <div className="space-y-2">
            <div>
              <p className="text-[11px] font-medium text-foreground">🆕 New Region</p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
                <li>Generates a brand new region with areas, nodes, creatures, and NPCs.</li>
                <li>Must include at least one inn node.</li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-medium text-foreground">🔗 Expand Region</p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
                <li>Adds content to an existing region — does NOT create a new region.</li>
                <li>New areas or <code className="text-[10px] bg-muted px-1 rounded">existing_area:&lt;uuid&gt;</code> for existing areas.</li>
                <li>New nodes must connect to at least one existing node via <code className="text-[10px] bg-muted px-1 rounded">existing:&lt;uuid&gt;</code>.</li>
                <li>Must not duplicate existing node names or NPC names.</li>
                <li>If the region already has an inn, no new inn is generated.</li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-medium text-foreground">🐛 Populate (Map-Integrated)</p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
                <li>Accessed via the <strong>Populate button</strong> on the World Map tab — select nodes visually, then enter a prompt.</li>
                <li>Generates <strong>only creatures</strong> — no new nodes, areas, or NPCs.</li>
                <li>Uses real node UUIDs as <code className="text-[10px] bg-muted px-1 rounded">node_temp_id</code>.</li>
                <li>Creature levels must match each node's region level range.</li>
                <li>Does not duplicate existing creature names on the same node.</li>
              </ul>
            </div>
          </div>
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
            <li><strong>Loot tables</strong> — created via the Loot Table Manager. AI only assigns existing tables.</li>
          </ul>
        </Card>
      </div>
    </ScrollArea>
  );
}
