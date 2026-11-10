import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ClassAbility } from './class-abilities';
import { resolveStanceForAbility, isStanceActive, type ReservedBuffsMap } from './stances';
import type { ActionReadiness } from '../action-readiness';
import { getKeyLabel, type ActionBindings } from '@/features/world';

interface Props {
  abilities: ClassAbility[];
  character: { id: string; hp: number; cp: number; level: number };
  creatures: readonly { id: string; is_alive: boolean }[];
  selectedTargetId?: string | null;
  allyTargetId?: string | null;
  availableCp?: number;
  actionsReady: boolean;
  getReadiness?: (index: number, targetId?: string) => ActionReadiness;
  onUseAbility?: (index: number, targetId?: string) => void;
  pendingIndex: number | null;
  pendingStage: 'preparing' | 'submitted' | null;
  reservations: ReservedBuffsMap | null;
  actionBindings?: ActionBindings;
}

/** Presentation only: readiness and commands belong to the authoritative session. */
export function EngineActionBar(props: Props) {
  if (!props.onUseAbility || props.abilities.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-1 justify-center max-w-full" aria-label="Combat abilities">
    {props.abilities.map((ability, index) => {
      const levelLocked = props.character.level < ability.levelRequired;
      const stance = resolveStanceForAbility(ability);
      const active = !!stance && isStanceActive(props.reservations, stance.key);
      const available = props.availableCp ?? props.character.cp;
      const insufficient = !active && available < ability.cpCost;
      const targetId = ability.targetType === 'enemy'
        ? props.creatures.find(c => c.id === props.selectedTargetId && c.is_alive)?.id
        : ability.targetType === 'ally' ? props.allyTargetId ?? props.character.id
        : ability.targetType === 'self' ? props.character.id : undefined;
      const missingTarget = ability.type === 'hp_transfer' && !targetId;
      const pending = props.pendingIndex === index;
      const readiness = props.getReadiness?.(index, targetId);
      const disabled = readiness ? !readiness.ready
        : !props.actionsReady || levelLocked || insufficient || props.character.hp <= 0 || missingTarget;
      const reason = readiness && 'message' in readiness ? readiness.message : null;
      const binding = props.actionBindings?.[`ability${index + 1}` as keyof ActionBindings]?.[0];
      const state = active ? 'bg-soulforged/15 border-soulforged text-soulforged hover:bg-soulforged/25'
        : pending ? 'border-elvish text-elvish ring-2 ring-elvish/70 motion-safe:animate-pulse'
        : 'text-elvish border-elvish/50';
      const detail = reason ?? (levelLocked ? `Unlocks at level ${ability.levelRequired}`
        : active ? `${ability.tooltip} · Active — click to drop (CP not refunded).`
        : pending ? `${ability.tooltip} · ${props.pendingStage === 'submitted' ? 'Waiting for the next combat tick…' : 'Preparing…'}`
        : `${ability.tooltip} · requires ${ability.cpCost} CP · ${available} available${missingTarget ? ' — select a target in party panel' : ''}`);
      return <Tooltip key={`${ability.abilityKey}:${index}`}>
        <TooltipTrigger asChild><span className="max-w-full">
          <Button variant="outline" size="sm" disabled={disabled} title={reason ?? undefined}
            aria-label={reason ? `${ability.label}: ${reason}` : ability.label}
            onClick={() => props.onUseAbility?.(index, targetId)}
            className={`font-display text-[10px] min-h-6 h-auto py-1 px-2 max-w-full whitespace-normal ${state}`}>
            {ability.label}
            {binding && !levelLocked && !insufficient && <span className="ml-0.5 text-[8px] text-muted-foreground">[{getKeyLabel(binding)}]</span>}
          </Button>
        </span></TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[200px]">{detail}</TooltipContent>
      </Tooltip>;
    })}
  </div>;
}