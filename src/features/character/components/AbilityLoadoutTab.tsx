/**
 * AbilityLoadoutTab — the character's Spellbook.
 *
 * One row per ability-bar slot, mirroring the bar itself: the slot's bound key
 * and role name sit on the left, and the techniques the character may bind into
 * that slot are listed to the right by name only — hovering a name reveals its
 * details. Picking one swaps the bar ability immediately. Locked while in
 * combat; options above the character's level are shown but not selectable.
 */
import { Lock } from 'lucide-react';
import { Character } from '@/features/character';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAbilityLoadout, type AbilityLoadoutState } from '@/hooks/useAbilityLoadout';

interface Props {
  character: Character;
  inCombat?: boolean;
  /** Shared state from GamePage; a local instance is used when omitted. */
  loadout?: AbilityLoadoutState;
}

export default function AbilityLoadoutTab({ character, inCombat, loadout }: Props) {
  const local = useAbilityLoadout(loadout ? undefined : character.id, character.class);
  const { allRoles, selections, saving, error, select } = loadout ?? local;

  if (allRoles.length === 0) {
    return (
      <p className="t-meta text-center py-4">
        Your order has not yet inscribed its techniques. They will appear here once revealed.
      </p>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col gap-1.5">
        {inCombat && (
          <p className="t-meta text-center text-destructive/80">
            Techniques cannot be reforged mid-battle.
          </p>
        )}
        {error && <p className="t-meta text-center text-destructive">{error}</p>}

        {allRoles.map((role, idx) => {
          const activeId =
            selections[role.roleId]
            ?? role.options.find(o => o.isDefault)?.abilityId
            ?? role.options[0]?.abilityId;
          const active = role.options.find(o => o.abilityId === activeId);
          const slotLocked = character.level < role.unlockLevel;

          return (
            <div
              key={role.roleId}
              className="flex items-stretch gap-2 rounded border border-border/60 bg-surface-2/40 p-1.5"
            >
              {/* Left: the bar slot itself — bound key, ability, role type. */}
              <div className="w-[104px] shrink-0 flex flex-col items-center justify-center gap-1 border-r border-border/50 pr-2">
                <div
                  className={[
                    'w-full rounded border px-1.5 py-1 text-center',
                    slotLocked
                      ? 'border-border/40 bg-surface-3/20 opacity-60'
                      : 'border-elvish/50 bg-surface-3/40',
                  ].join(' ')}
                >
                  <span className="font-display text-[10px] text-elvish block truncate">
                    {active ? `${active.ability.emoji} ${active.ability.label}` : '—'}
                  </span>
                  <span className="t-meta text-[8px]">[{idx + 1}]</span>
                </div>
                <span className="t-label text-[9px] tracking-wide text-primary/80 text-center leading-tight">
                  {role.name}
                </span>
                <span className="t-meta text-[9px]">
                  {slotLocked ? `Lvl ${role.unlockLevel}` : 'bound'}
                </span>
              </div>

              {/* Right: selectable techniques, name only + hover details. */}
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                {role.options.map(option => {
                  const isActive = option.abilityId === activeId;
                  const locked = character.level < option.ability.levelRequired;
                  const disabled = locked || !!inCombat || saving || isActive;
                  return (
                    <Tooltip key={option.abilityId}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => select(role.roleId, option.abilityId)}
                          className={[
                            'flex items-center gap-1.5 text-left rounded px-2 py-1 border transition-colors',
                            isActive
                              ? 'border-primary/70 bg-primary/10'
                              : 'border-border/50 bg-surface-3/30 hover:border-primary/40',
                            disabled && !isActive ? 'opacity-50 cursor-not-allowed' : '',
                          ].join(' ')}
                        >
                          <span aria-hidden>{option.ability.emoji}</span>
                          <span className="t-label text-[11px] truncate">
                            {option.ability.label}
                          </span>
                          {locked && (
                            <Lock className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[220px] z-50">
                        <p className="t-label text-[11px]">
                          {option.ability.emoji} {option.ability.label}
                          {option.isDefault && <span className="t-meta"> · traditional</span>}
                        </p>
                        <p className="t-meta mt-0.5">{option.ability.tooltip}</p>
                        <p className="t-numeric text-[10px] text-primary/80 mt-1">
                          {option.ability.cpCost} CP · Lvl {option.ability.levelRequired}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
