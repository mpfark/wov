import { Check, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { AbilityLoadoutState } from '@/hooks/useAbilityLoadout';
import { damageTypeLabel, getDamageType } from '@/shared/combat/damage-types';

interface Props {
  level: number;
  inCombat?: boolean;
  loadout: AbilityLoadoutState;
}

/** Configured choices use the existing owner-validated loadout command. */
export function EngineSpellbook({ level, inCombat, loadout }: Props) {
  const { allRoles, selections, loading, saving, error, select } = loadout;
  if (loading && allRoles.length === 0) return <p role="status" className="t-meta py-4 text-center">Loading techniques…</p>;
  if (allRoles.length === 0) return <p className="t-meta py-4 text-center">Your order has not yet inscribed its techniques.</p>;
  return <TooltipProvider delayDuration={150}>
    <section aria-label="Spellbook" className="space-y-3 min-w-0">
      {inCombat && <p className="t-meta text-destructive">Techniques cannot be reforged mid-battle.</p>}
      {error && <p role="alert" className="t-meta text-destructive">{error}</p>}
      {saving && <p role="status" className="t-meta">Binding technique…</p>}
      {allRoles.map(role => {
        const activeId = selections[role.roleId] ?? role.options.find(option => option.isDefault)?.abilityId ?? role.options[0]?.abilityId;
        const slotLocked = level < role.unlockLevel;
        return <div key={role.roleId} className="min-w-0 border-b border-border/60 pb-3">
          <header className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[10px] tabular-nums text-muted-foreground">{role.slot}</span>
            <h3 className="font-display text-xs text-primary">{role.name}</h3>
            {slotLocked && <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground"><Lock className="h-3 w-3" />Lvl {role.unlockLevel}</span>}
          </header>
          <div className="space-y-1">
            {role.options.map(option => {
              const active = option.abilityId === activeId;
              const locked = slotLocked || level < option.ability.levelRequired;
              return <Tooltip key={option.abilityId}>
                <TooltipTrigger asChild><span className="block">
                  <Button variant="outline" aria-pressed={active} disabled={locked || !!inCombat || loading || saving || active}
                    onClick={() => { if (!locked && !inCombat && !loading && !saving && !active) void select(role.roleId, option.abilityId); }}
                    className={`h-auto min-h-10 w-full min-w-0 justify-between gap-2 whitespace-normal px-2 py-2 text-left ${active ? 'border-primary/70 bg-primary/10' : 'border-border/50'}`}>
                    <span className="min-w-0 break-words font-display text-[11px]">{option.ability.label}</span>
                    <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">{option.ability.cpCost} CP{active ? <Check className="h-3 w-3 text-primary" /> : locked ? <Lock className="h-3 w-3" /> : null}</span>
                  </Button>
                </span></TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  <p>{option.ability.tooltip}</p>
                  <p className="mt-1 text-muted-foreground">Lvl {option.ability.levelRequired}{getDamageType(option.damageType) ? ` · ${damageTypeLabel(option.damageType)}` : ''}</p>
                </TooltipContent>
              </Tooltip>;
            })}
          </div>
        </div>;
      })}
    </section>
  </TooltipProvider>;
}