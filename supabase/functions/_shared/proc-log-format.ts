/**
 * Shared proc log-message formatter.
 * Single source of truth — imported by both combat-tick (Deno) and admin UI (Vite via @shared alias).
 */

export interface ProcLogInput {
  type: string;
  value: number;
  emoji: string;
  text: string;
}

export function formatProcMessage(
  proc: ProcLogInput,
  attackerName: string,
  targetName: string,
): string {
  const suffix = (() => {
    switch (proc.type) {
      case 'lifesteal':
      case 'heal_pulse':
        return ` (+${proc.value} HP)`;
      case 'burst_damage':
        return ` (${proc.value} dmg)`;
      case 'weaken':
        return ` (${Math.round(proc.value * 100)}% weaken)`;
      default:
        return '';
    }
  })();

  return `${proc.emoji} ${attackerName}'s weapon ${proc.text} ${targetName}!${suffix}`;
}
