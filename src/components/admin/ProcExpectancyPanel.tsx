/**
 * Read-only expected-value readout for an item's chance-on-hit procs.
 * Pure item math — chance × value per entry, no attacker context.
 * Matches the resolution gate in supabase/functions/combat-tick/index.ts.
 */

interface ProcEntry {
  type: string;
  chance: number;
  value: number;
  emoji?: string;
  text?: string;
}

interface Props {
  procs: ProcEntry[] | undefined | null;
}

type Bucket = 'damage' | 'healing' | 'mitigation' | 'other';

function classify(type: string): Bucket {
  switch (type) {
    case 'burst_damage':
      return 'damage';
    case 'lifesteal':
    case 'heal_pulse':
      return 'healing';
    case 'weaken':
      return 'mitigation';
    default:
      return 'other';
  }
}

function unitLabel(type: string): string {
  switch (type) {
    case 'burst_damage':
      return 'dmg/hit';
    case 'lifesteal':
    case 'heal_pulse':
      return 'HP/hit';
    case 'weaken':
      return 'avg mitigation';
    default:
      return 'EV/hit';
  }
}

function formatValue(type: string, value: number): string {
  return type === 'weaken' ? `${Math.round(value * 100)}%` : String(value);
}

function formatEv(type: string, ev: number): string {
  if (type === 'weaken') return `${(ev * 100).toFixed(1)}%`;
  return ev.toFixed(2);
}

export function ProcExpectancyPanel({ procs }: Props) {
  if (!Array.isArray(procs) || procs.length === 0) return null;

  let sumDamage = 0;
  let sumHealing = 0;
  let sumMitigation = 0;

  const rows = procs.map((p, i) => {
    const ev = (p.chance || 0) * (p.value || 0);
    const bucket = classify(p.type);
    if (bucket === 'damage') sumDamage += ev;
    else if (bucket === 'healing') sumHealing += ev;
    else if (bucket === 'mitigation') sumMitigation += ev;
    return { ...p, ev, bucket, idx: i };
  });

  return (
    <div className="mt-2 rounded border border-border bg-background/40 p-2">
      <p className="text-[10px] font-display text-primary mb-1.5">Proc Expectancy (per hit)</p>
      <div className="space-y-0.5">
        {rows.map(r => (
          <div key={r.idx} className="flex items-center gap-2 text-[10px] font-mono">
            <span className="w-5 text-center">{r.emoji || '•'}</span>
            <span className="w-20 capitalize text-muted-foreground">{r.type.replace('_', ' ')}</span>
            <span className="w-16 text-right">{Math.round((r.chance || 0) * 100)}%</span>
            <span className="text-muted-foreground">×</span>
            <span className="w-12 text-right">{formatValue(r.type, r.value)}</span>
            <span className="text-muted-foreground">=</span>
            <span className="w-16 text-right text-foreground font-semibold">{formatEv(r.type, r.ev)}</span>
            <span className="text-muted-foreground">{unitLabel(r.type)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-border/50 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] font-mono">
        {sumDamage > 0 && (
          <span>Σ damage: <span className="text-foreground font-semibold">{sumDamage.toFixed(2)}</span> /hit</span>
        )}
        {sumHealing > 0 && (
          <span>Σ healing: <span className="text-foreground font-semibold">{sumHealing.toFixed(2)}</span> /hit</span>
        )}
        {sumMitigation > 0 && (
          <span>Σ mitigation: <span className="text-foreground font-semibold">{(sumMitigation * 100).toFixed(1)}%</span></span>
        )}
      </div>
    </div>
  );
}
