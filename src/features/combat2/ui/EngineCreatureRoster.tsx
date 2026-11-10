import { Crosshair, Shield, Swords } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { Creature } from '@/features/creatures';
import { Combat2EffectPills } from '../Combat2EffectPills';
import { Combat2TelegraphIndicator } from '../Combat2TelegraphIndicator';
import { combat2CreatureLifeKey, type Combat2PresentationEffect, type Combat2PresentationTelegraph } from '../presentation';
import { shouldShowAttackControl } from '../attack-control';

interface Props {
  creatures: readonly Creature[];
  rosterActionable: boolean;
  playerAlive?: boolean;
  selectedTargetId?: string | null;
  activeTargetId?: string | null;
  engagedIds: readonly string[];
  pendingTargetId?: string | null;
  hpOverrides: Readonly<Record<string, number>>;
  effects?: Readonly<Record<string, readonly Combat2PresentationEffect[]>>;
  telegraphs?: Readonly<Record<string, Combat2PresentationTelegraph>>;
  tankByLife?: Readonly<Record<string, boolean>>;
  encounterTick: number;
  flashingIds?: ReadonlySet<string>;
  onSelectTarget?: (id: string) => void;
  onAttack: (id: string) => void;
}

/** Roster authority and accepted projections only; no legacy debuff/cast inference. */
export function EngineCreatureRoster(props: Props) {
  return <div className="space-y-1" aria-label="Encounter creatures">
    {props.creatures.map(creature => {
      const life = combat2CreatureLifeKey(creature.id, creature.spawn_seq ?? 0);
      const hp = props.hpOverrides[creature.id] ?? creature.hp;
      const hpReady = props.rosterActionable || props.hpOverrides[creature.id] !== undefined;
      const living = creature.is_alive && hp > 0;
      const selected = props.selectedTargetId === creature.id;
      const engaged = props.engagedIds.includes(creature.id);
      const pending = props.pendingTargetId === creature.id;
      const active = props.activeTargetId === creature.id;
      const telegraph = props.telegraphs?.[life];
      const tanking = props.tankByLife?.[life] === true;
      const pct = Math.max(0, Math.min(100, hp / Math.max(1, creature.max_hp) * 100));
      const border = active ? 'border-destructive/60' : selected ? 'border-primary/60' : engaged ? 'border-dwarvish/50' : 'border-border';
      return <article key={life} aria-label={creature.name} className={`min-w-0 rounded border bg-background/50 p-2 ${border} ${props.flashingIds?.has(creature.id) ? 'motion-safe:animate-aggro-flash' : ''}`}>
        <div className="flex items-start gap-2">
          <Button variant="ghost" disabled={!living || !props.onSelectTarget} aria-pressed={selected}
            aria-label={`Target ${creature.name}`} onClick={() => props.onSelectTarget?.(creature.id)}
            className="h-auto min-h-8 min-w-0 flex-1 justify-start whitespace-normal px-0 py-1 text-left">
            <span className="min-w-0 break-words font-display text-xs">{creature.name}</span>
            {selected && <Crosshair className="h-3 w-3 shrink-0 text-primary" />}
          </Button>
          <span className="shrink-0 pt-2 text-[10px] text-muted-foreground">L{creature.level}</span>
          {shouldShowAttackControl({ authoritative: true, living, engaged, pending, legacyAvailable: false }) &&
            <Button size="sm" variant="destructive" disabled={!props.rosterActionable || props.playerAlive === false}
              title={props.rosterActionable ? undefined : 'Confirming who stands here…'}
              onClick={() => { if (props.rosterActionable && living && props.playerAlive !== false) props.onAttack(creature.id); }}
              className="h-8 shrink-0 gap-1 px-2 font-display text-[10px]"><Swords className="h-3 w-3" />Attack</Button>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px]">
          {selected && <span className="text-primary">Selected target</span>}
          {pending && <span role="status" className="text-elvish">Attack preparing</span>}
          {engaged && <span className="text-dwarvish">Engaged</span>}
          {tanking && <span className="flex items-center gap-1 text-chart-2"><Shield className="h-3 w-3" />Tanking</span>}
          {creature.is_aggressive && <span className="text-destructive">Aggressive</span>}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Progress value={hpReady ? pct : 0} aria-label={`${creature.name} HP`} className={`h-2 min-w-0 flex-1 ${telegraph ? 'ring-1 ring-destructive/60' : ''}`} />
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{hpReady ? `${hp}/${creature.max_hp}` : <span role="status" aria-label={`Loading HP for ${creature.name}`}>HP…</span>}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1 min-w-0 break-words">
          <Combat2EffectPills effects={props.effects?.[creature.id] ?? []} />
          {telegraph && <Combat2TelegraphIndicator telegraph={telegraph} encounterTick={props.encounterTick} />}
        </div>
      </article>;
    })}
  </div>;
}