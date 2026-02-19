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

        {/* General Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">General Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>All names must use <strong>ASCII-only</strong> characters (A-Z, a-z, spaces, hyphens, apostrophes). No accented/diacritic characters.</li>
            <li>No copyrighted content — original names inspired by high-fantasy, not taken from Tolkien, D&D, etc.</li>
            <li>Directional codes use <strong>short codes only</strong>: N, S, E, W, NE, NW, SE, SW. Never full words.</li>
            <li>Temp IDs (e.g. "node_1") must <strong>never</strong> appear in name fields — only in temp_id and connection references.</li>
          </ul>
        </Card>

        {/* Region Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Region Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Every region must have at least <strong>one inn</strong> node for resting.</li>
            <li>Regions have a <code className="text-[10px] bg-muted px-1 rounded">min_level</code> and <code className="text-[10px] bg-muted px-1 rounded">max_level</code> range.</li>
            <li>All creature levels within a region must fall within its level range.</li>
          </ul>
        </Card>

        {/* Node Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Node Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Node names must be clean, lore-appropriate place names (e.g. "Thornwood Clearing").</li>
            <li>Never append temp IDs, booleans, or metadata to node names.</li>
            <li><code className="text-[10px] bg-muted px-1 rounded">is_inn</code>, <code className="text-[10px] bg-muted px-1 rounded">is_vendor</code>, <code className="text-[10px] bg-muted px-1 rounded">is_blacksmith</code> are separate boolean fields — never in the name.</li>
            <li>Connections between generated nodes must be <strong>bidirectional</strong>.</li>
            <li>In expand mode, use <code className="text-[10px] bg-muted px-1 rounded">existing:&lt;uuid&gt;</code> in <code className="text-[10px] bg-muted px-1 rounded">target_temp_id</code> to reference existing nodes.</li>
          </ul>
        </Card>

        {/* Creature Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Creature Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li><strong>2–4 creatures per node</strong>, mix of aggressive and passive.</li>
            <li>Stats: str, dex, con, int, wis, cha — range <strong>5–30</strong> based on level.</li>
            <li>Rarity distribution: mostly <Badge variant="outline" className="text-[9px] px-1 py-0">regular</Badge>, a few <Badge variant="secondary" className="text-[9px] px-1 py-0">rare</Badge>, 1–2 <Badge variant="destructive" className="text-[9px] px-1 py-0">boss</Badge> per region.</li>
            <li>Mark <code className="text-[10px] bg-muted px-1 rounded">is_humanoid: true</code> for bandits, soldiers, cultists, mages, knights — anything with a human form.</li>
          </ul>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">HP Formula:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">base 10 + (level × 3) · ×1.5 for rare · ×3 for boss</code>
          </div>
          <div className="text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground text-[11px] mb-0.5">AC Formula:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">8 + floor(level / 3) · +2 for rare · +4 for boss</code>
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

        {/* Item Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Item Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Only <strong>humanoid creatures</strong> (<code className="text-[10px] bg-muted px-1 rounded">is_humanoid: true</code>) can carry items.</li>
            <li>Max <strong>1–2 items</strong> per humanoid creature.</li>
            <li>Only <Badge variant="outline" className="text-[9px] px-1 py-0">equipment</Badge> and <Badge variant="outline" className="text-[9px] px-1 py-0">consumable</Badge> types — no trash loot.</li>
            <li>Drop chance: <strong>0.1 – 0.5</strong></li>
            <li>Never generate <Badge variant="secondary" className="text-[9px] px-1 py-0">unique</Badge> rarity items.</li>
            <li>Rarity: <Badge variant="outline" className="text-[9px] px-1 py-0">common</Badge> / <Badge variant="outline" className="text-[9px] px-1 py-0">uncommon</Badge> for regular creatures, up to <Badge variant="secondary" className="text-[9px] px-1 py-0">rare</Badge> for rare/boss.</li>
            <li>Do not duplicate existing item names.</li>
          </ul>
          <div className="text-[11px] text-muted-foreground mt-1">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Stat Budget:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">floor(level × 0.3 × rarity_multiplier × hands_multiplier)</code>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1.5 text-[10px]">
            <div>
              <p className="font-medium text-foreground mb-0.5">Rarity Multipliers</p>
              <div className="text-muted-foreground space-y-0.5">
                <div>Common: <strong>1.0</strong></div>
                <div>Uncommon: <strong>1.5</strong></div>
                <div>Rare: <strong>2.0</strong></div>
                <div>Unique: <strong>3.0</strong></div>
              </div>
            </div>
            <div>
              <p className="font-medium text-foreground mb-0.5">Hands Multiplier</p>
              <div className="text-muted-foreground space-y-0.5">
                <div>One-handed: <strong>1.0</strong></div>
                <div>Two-handed (hands=2): <strong>1.5</strong></div>
              </div>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Valid Equipment Slots:</p>
            <div className="flex flex-wrap gap-1">
              {['main_hand', 'off_hand', 'head', 'chest', 'gloves', 'belt', 'pants', 'ring', 'trinket', 'boots', 'amulet', 'shoulders'].map(s => (
                <Badge key={s} variant="outline" className="text-[9px] px-1 py-0">{s}</Badge>
              ))}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Valid Stat Keys:</p>
            <div className="flex flex-wrap gap-1">
              {['str', 'dex', 'con', 'int', 'wis', 'cha', 'ac', 'hp', 'hp_regen'].map(s => (
                <Badge key={s} variant="outline" className="text-[9px] px-1 py-0">{s}</Badge>
              ))}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Durability Ranges:</p>
            <div className="text-[10px] space-y-0.5">
              <div>Common: <strong>50–100</strong></div>
              <div>Uncommon: <strong>75–150</strong></div>
              <div>Rare: <strong>100–200</strong></div>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Gold Value:</p>
            <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded block">floor(level × 2.5 × rarity_multiplier²)</code>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            <p className="font-medium text-foreground text-[11px] mb-0.5">Consumables:</p>
            <ul className="list-disc pl-4 text-[10px] space-y-0.5">
              <li>Slot: <code className="bg-muted px-1 rounded">null</code></li>
              <li>Stats: <code className="bg-muted px-1 rounded">hp</code> (restore amount) or <code className="bg-muted px-1 rounded">hp_regen</code></li>
            </ul>
          </div>
        </Card>

        {/* Populate Mode Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Populate Mode Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Do <strong>NOT</strong> generate new nodes — the nodes array must be empty.</li>
            <li>Do <strong>NOT</strong> generate NPCs — the npcs array must be empty.</li>
            <li>Use <strong>real node IDs</strong> (UUIDs) as <code className="text-[10px] bg-muted px-1 rounded">node_temp_id</code> for creatures.</li>
            <li>Creature levels must match each node's region level range.</li>
            <li>Do not duplicate existing creature names on the same node.</li>
          </ul>
        </Card>

        {/* Expand Mode Rules */}
        <Card className="p-3 space-y-1.5">
          <h3 className="font-display text-sm text-primary">Expand Mode Rules</h3>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            <li>Do <strong>NOT</strong> generate a new region — reuse the existing region's data.</li>
            <li>New nodes must connect to at least one existing node via <code className="text-[10px] bg-muted px-1 rounded">existing:&lt;uuid&gt;</code>.</li>
            <li>New nodes can also connect to other new nodes using temp IDs.</li>
            <li>Creature levels must stay within the region's level range.</li>
            <li>Do not duplicate existing node names or NPC names.</li>
          </ul>
        </Card>
      </div>
    </ScrollArea>
  );
}
