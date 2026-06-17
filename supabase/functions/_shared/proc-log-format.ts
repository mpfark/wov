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

/**
 * Interpolate %a/%e/%v template variables in a text string.
 * Shared by proc formatting AND boss-flavor formatting to prevent sync drift.
 */
export function interpolateTemplate(
  text: string,
  attackerName: string,
  targetName: string,
  value: number,
): string {
  return text
    .replace(/%a/g, attackerName)
    .replace(/%e/g, targetName)
    .replace(/%v/g, String(value));
}

export function formatProcMessage(
  proc: ProcLogInput & { duration_sec?: number; attribute?: string },
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
      case 'buff_ac': {
        const dur = proc.duration_sec ?? 30;
        return ` (+${Math.max(1, Math.round(proc.value || 0))} AC, ${dur}s)`;
      }
      case 'buff_attribute': {
        const dur = proc.duration_sec ?? 30;
        const a = String(proc.attribute || 'str').toUpperCase();
        return ` (+${Math.max(1, Math.round(proc.value || 0))} ${a}, ${dur}s)`;
      }
      case 'buff_resist': {
        const dur = proc.duration_sec ?? 30;
        return ` (${Math.max(1, Math.min(95, Math.round((proc.value || 0) * 100)))}% DR, ${dur}s)`;
      }
      default:
        return '';
    }
  })();

  const interpolated = interpolateTemplate(proc.text, attackerName, targetName, proc.value);

  return `${proc.emoji} ${interpolated}!${suffix}`;
}
