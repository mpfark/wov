import type { AdminCharacter, AdminNode } from './constants';
import { CLASS_LABELS, RACE_LABELS } from '@/lib/game-data';

interface Props {
  character: AdminCharacter;
  nodeName?: string;
}

export default function CharacterSummaryCard({ character: c, nodeName }: Props) {
  const hpPct = Math.round((c.hp / c.max_hp) * 100);
  const cpPct = c.max_cp > 0 ? Math.round((c.cp / c.max_cp) * 100) : 0;

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-sm text-primary text-glow">{c.name}</h3>
          <p className="text-[10px] text-muted-foreground">
            {c.gender === 'male' ? '♂' : '♀'}{' '}
            {RACE_LABELS[c.race as keyof typeof RACE_LABELS]}{' '}
            {CLASS_LABELS[c.class as keyof typeof CLASS_LABELS]} — Lvl {c.level}
          </p>
        </div>
        <div className="text-right text-[10px]">
          <div className="text-primary font-display">{c.gold}g</div>
          {nodeName && <div className="text-muted-foreground truncate max-w-[120px]">📍 {nodeName}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* HP */}
        <div>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground">HP</span>
            <span className="text-blood">{c.hp}/{c.max_hp}</span>
          </div>
          <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
            <div
              className="h-full transition-all duration-500 rounded-full"
              style={{
                width: `${hpPct}%`,
                background: hpPct > 50 ? 'hsl(var(--elvish))' : hpPct > 25 ? 'hsl(var(--gold))' : 'hsl(var(--blood))',
              }}
            />
          </div>
        </div>
        {/* CP */}
        <div>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground">CP</span>
            <span className="text-primary">{c.cp}/{c.max_cp}</span>
          </div>
          <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
            <div
              className="h-full transition-all duration-500 rounded-full"
              style={{
                width: `${cpPct}%`,
                background: 'linear-gradient(90deg, hsl(var(--primary) / 0.7), hsl(var(--primary)))',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
