import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function WorldBuilderRulebook() {
  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-4 max-w-2xl">
        <div>
          <h2 className="font-display text-lg text-primary mb-1">📜 AI Rulebook</h2>
          <p className="text-xs text-muted-foreground">
            Reference of all rules the AI follows when generating world content. These match exactly what the system prompt enforces.
          </p>
        </div>

        {/* World Structure */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">World Structure: Region → Area → Node</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>A <strong>Region</strong> has a name, level range, and description.</li>
            <li>An <strong>Area</strong> groups nodes by place type (forest, town, cave, etc.) and provides a shared name and description.</li>
            <li><strong>Nodes</strong> are individual locations within an area. They do NOT need unique names — unnamed nodes display their area name.</li>
            <li>Only give a node its own name if it's a <strong>special/notable location</strong> (inn, vendor, blacksmith, boss lair, landmark).</li>
          </ul>
        </Card>

        {/* General Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">General Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>All names must use <strong>ASCII-only</strong> characters (A-Z, a-z, spaces, hyphens, apostrophes). No accented/diacritic characters.</li>
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
            <li>If the region <strong>already has an inn</strong>, the AI will <strong>not</strong> generate another one.</li>
            <li>Regions have a <code className="text-[10px] bg-muted px-1 rounded">min_level</code> and <code className="text-[10px] bg-muted px-1 rounded">max_level</code> range.</li>
            <li>All creature levels within a region must fall within its level range.</li>
          </ul>
        </Card>

        {/* Node Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Node Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Most nodes should have an <strong>empty name</strong> — they inherit the area name.</li>
            <li>Only set a node name for special locations: inns, vendors, blacksmiths, boss lairs, landmarks.</li>
            <li><code className="text-[10px] bg-muted px-1 rounded">is_inn</code>, <code className="text-[10px] bg-muted px-1 rounded">is_vendor</code>, <code className="text-[10px] bg-muted px-1 rounded">is_blacksmith</code> are separate boolean fields — never in the name.</li>
            <li>Connections between generated nodes must be <strong>bidirectional</strong>.</li>
            <li>In expand mode, use <code className="text-[10px] bg-muted px-1 rounded">existing:&lt;uuid&gt;</code> in <code className="text-[10px] bg-muted px-1 rounded">target_temp_id</code> to reference existing nodes.</li>
          </ul>
        </Card>

        {/* Creature Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Creature Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li><strong>1–4 creatures per node</strong>, mix of aggressive and passive.</li>
            <li>Rarity distribution: mostly <Badge variant="outline" className="text-[9px] px-1 py-0">regular</Badge>, a few <Badge variant="secondary" className="text-[9px] px-1 py-0">rare</Badge>, at most 1 <Badge variant="destructive" className="text-[9px] px-1 py-0">boss</Badge> per region.</li>
            <li>Mark <code className="text-[10px] bg-muted px-1 rounded">is_humanoid: true</code> for bandits, soldiers, cultists, mages, knights — anything with a human form.</li>
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
        </Card>

        {/* NPC Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">NPC Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li><strong>1–2 NPCs</strong> for inn, vendor, and blacksmith nodes.</li>
            <li>Dialogue must be lore-appropriate and atmospheric.</li>
            <li>NPC names must not duplicate existing ones when expanding.</li>
          </ul>
        </Card>

        {/* Loot Table Assignment Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Loot Table Assignment</h3>
          <p className="text-[11px] text-muted-foreground">
            The World Builder does <strong>not</strong> generate items. Items are created separately via the <strong>Item Forge</strong>. Instead, the AI assigns existing loot tables to creatures.
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Only <strong>humanoid creatures</strong> (<code className="text-[10px] bg-muted px-1 rounded">is_humanoid: true</code>) should be assigned loot tables.</li>
            <li>Non-humanoid creatures (beasts, monsters) get <code className="text-[10px] bg-muted px-1 rounded">loot_table_id: null</code>.</li>
            <li>The AI picks a loot table whose <strong>item levels are within ±3 levels</strong> of the creature's level.</li>
            <li>Item rarities in the table should match the creature: <Badge variant="outline" className="text-[9px] px-1 py-0">common</Badge> / <Badge variant="outline" className="text-[9px] px-1 py-0">uncommon</Badge> for regular creatures, up to <Badge variant="secondary" className="text-[9px] px-1 py-0">rare</Badge> for rare/boss.</li>
            <li>If no suitable loot table exists, the creature gets <code className="text-[10px] bg-muted px-1 rounded">loot_table_id: null</code> — the AI never invents IDs.</li>
            <li>Drop chance: <strong>0.1 – 0.5</strong> — stored as the creature's <code className="text-[10px] bg-muted px-1 rounded">drop_chance</code> field.</li>
            <li>Loot table IDs are validated server-side — any non-existent ID is silently set to null.</li>
          </ul>
        </Card>

        {/* Populate Mode Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Populate Mode Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Do <strong>NOT</strong> generate new nodes or areas — the nodes and areas arrays must be empty.</li>
            <li>Do <strong>NOT</strong> generate NPCs — the npcs array must be empty.</li>
            <li>Use <strong>real node IDs</strong> (UUIDs) as <code className="text-[10px] bg-muted px-1 rounded">node_temp_id</code> for creatures.</li>
            <li>Creature levels must match each node's region level range.</li>
            <li>Do not duplicate existing creature names on the same node.</li>
            <li>Humanoid creatures are assigned existing loot tables matching their level and rarity.</li>
          </ul>
        </Card>

        {/* Expand Mode Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Expand Mode Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Do <strong>NOT</strong> generate a new region — reuse the existing region's data.</li>
            <li>Generate new <strong>areas</strong> for new groups of nodes, or use <code className="text-[10px] bg-muted px-1 rounded">existing_area:&lt;uuid&gt;</code> to add nodes to existing areas.</li>
            <li>New nodes must connect to at least one existing node via <code className="text-[10px] bg-muted px-1 rounded">existing:&lt;uuid&gt;</code>.</li>
            <li>New nodes can also connect to other new nodes using temp IDs.</li>
            <li>Creature levels must stay within the region's level range.</li>
            <li>Do not duplicate existing node names or NPC names.</li>
            <li>Humanoid creatures are assigned existing loot tables matching their level and rarity.</li>
          </ul>
        </Card>
      </div>
    </ScrollArea>
  );
}
