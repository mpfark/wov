/**
 * AbilityLoadoutTab — player-facing ability choices (Phase 4).
 *
 * One card per role that offers alternatives; picking an option swaps the
 * ability in that bar slot immediately. Locked while in combat, and options
 * above the character's level are shown but not selectable.
 */
import { Lock } from 'lucide-react';
import { Character } from '@/features/character';
import { useAbilityLoadout } from '@/hooks/useAbilityLoadout';

interface Props {
  character: Character;
  inCombat?: boolean;
}

export default function AbilityLoadoutTab({ character, inCombat }: Props) {
  const { roles, selections, saving, error, select } =
    useAbilityLoadout(character.id, character.class);

  if (roles.length === 0) {
    return (
      <p className="t-meta text-center py-4">
        Your order teaches a single path for each discipline. Alternative techniques will
        appear here when they are revealed.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {inCombat && (
        <p className="t-meta text-center text-destructive/80">
          Techniques cannot be reforged mid-battle.
        </p>
      )}
      {error && <p className="t-meta text-center text-destructive">{error}</p>}

      {roles.map(role => {
        const activeId =
          selections[role.roleId]
          ?? role.options.find(o => o.isDefault)?.abilityId
          ?? role.options[0]?.abilityId;

        return (
          <div key={role.roleId} className="rounded border border-border/60 bg-surface-2/40 p-2">
            <div className="flex items-baseline justify-between">
              <span className="t-label text-[10px] tracking-wide text-primary/80">{role.name}</span>
              <span className="t-meta">Lvl {role.unlockLevel}</span>
            </div>

            <div className="flex flex-col gap-1 mt-1.5">
              {role.options.map(option => {
                const isActive = option.abilityId === activeId;
                const locked = character.level < option.ability.levelRequired;
                const disabled = locked || !!inCombat || saving || isActive;
                return (
                  <button
                    key={option.abilityId}
                    type="button"
                    disabled={disabled}
                    onClick={() => select(role.roleId, option.abilityId)}
                    className={[
                      'text-left rounded px-2 py-1.5 border transition-colors',
                      isActive
                        ? 'border-primary/70 bg-primary/10'
                        : 'border-border/50 bg-surface-3/30 hover:border-primary/40',
                      disabled && !isActive ? 'opacity-50 cursor-not-allowed' : '',
                    ].join(' ')}
                  >
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden>{option.ability.emoji}</span>
                      <span className="t-label text-[11px]">{option.ability.label}</span>
                      {option.isDefault && <span className="t-meta">· traditional</span>}
                      {locked && <Lock className="w-3 h-3 text-muted-foreground" />}
                      <span className="t-numeric text-[10px] text-primary/70 ml-auto">
                        {option.ability.cpCost} CP
                      </span>
                    </span>
                    <span className="t-meta block mt-0.5">{option.ability.tooltip}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
