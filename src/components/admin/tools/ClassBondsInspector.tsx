import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Row {
  character_id: string;
  class: string;
  bond: number;
  updated_at: string;
  character_name?: string;
}

const CLASSES = ['warrior', 'wizard', 'ranger', 'rogue', 'healer', 'bard', 'templar'] as const;

export default function ClassBondsInspector() {
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('character_class_bonds' as any)
      .select('character_id, class, bond, updated_at, characters!inner(name)')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (error) {
      toast.error(error.message);
    } else {
      setRows(
        (data as any[]).map((r) => ({
          character_id: r.character_id,
          class: r.class,
          bond: r.bond,
          updated_at: r.updated_at,
          character_name: r.characters?.name,
        })),
      );
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const setBond = async (character_id: string, klass: string, bond: number) => {
    const v = Math.max(0, Math.min(100, Math.floor(bond)));
    const { error } = await supabase
      .from('character_class_bonds' as any)
      .upsert({ character_id, class: klass, bond: v, updated_at: new Date().toISOString() });
    if (error) toast.error(error.message);
    else { toast.success(`Set ${klass} bond → ${v}`); load(); }
  };

  const filtered = rows.filter((r) => {
    const q = filter.toLowerCase().trim();
    if (!q) return true;
    return (r.character_name ?? '').toLowerCase().includes(q) || r.class.includes(q);
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter by character or class…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} rows</span>
      </div>

      <div className="text-xs text-muted-foreground">
        Bond ranges 0–100. Existing characters were seeded at 100 in their current class.
        Class abilities currently ignore Bond (multiplier locked at 1.0 in Phase 1).
        Valid classes: {CLASSES.join(', ')}.
      </div>

      <div className="border border-border rounded">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left p-2">Character</th>
              <th className="text-left p-2">Class</th>
              <th className="text-left p-2 w-32">Bond</th>
              <th className="text-left p-2">Updated</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <BondRow key={`${r.character_id}-${r.class}`} row={r} onSet={setBond} />
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No bonds found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BondRow({ row, onSet }: { row: Row; onSet: (cid: string, klass: string, v: number) => void }) {
  const [val, setVal] = useState(String(row.bond));
  useEffect(() => { setVal(String(row.bond)); }, [row.bond]);
  return (
    <tr className="border-t border-border">
      <td className="p-2 font-medium">{row.character_name ?? row.character_id.slice(0, 8)}</td>
      <td className="p-2 capitalize">{row.class}</td>
      <td className="p-2">
        <Input
          type="number"
          min={0}
          max={100}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="h-7 w-20"
        />
      </td>
      <td className="p-2 text-muted-foreground">{new Date(row.updated_at).toLocaleString()}</td>
      <td className="p-2 text-right">
        <Button size="sm" variant="outline" onClick={() => onSet(row.character_id, row.class, Number(val))}>
          Save
        </Button>
      </td>
    </tr>
  );
}
