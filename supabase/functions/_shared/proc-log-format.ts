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

/** Variables available to every authored flavor string (boss casts, boss crits, procs). */
export interface FlavorVars {
  creature?: string;
  target?: string;
  cast?: string;
  damage?: number | string;
}

export const FLAVOR_MAX_LEN = 240;

/**
 * Canonical flavor renderer. One helper for boss casts, boss crit flavors and
 * procs so authored text behaves identically everywhere.
 *
 * Tokens: {creature} {target} {cast} {damage}
 * Legacy aliases (still supported): %a = creature, %e = target, %v = damage
 */
export function renderFlavor(template: string, vars: FlavorVars = {}): string {
  const creature = vars.creature ?? '';
  const target = vars.target ?? '';
  const cast = vars.cast ?? '';
  const damage = vars.damage === undefined || vars.damage === null ? '' : String(vars.damage);

  const out = String(template ?? '')
    .replace(/\{creature\}/gi, creature)
    .replace(/\{target\}/gi, target)
    .replace(/\{cast\}/gi, cast)
    .replace(/\{damage\}/gi, damage)
    .replace(/%a/g, creature)
    .replace(/%e/g, target)
    .replace(/%v/g, damage)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return out.length > FLAVOR_MAX_LEN ? out.slice(0, FLAVOR_MAX_LEN).trimEnd() : out;
}

/** True when the author already wrote the damage number into the template. */
export function flavorHasDamageToken(template: string): boolean {
  return /\{damage\}/i.test(String(template ?? '')) || /%v/.test(String(template ?? ''));
}

/**
 * Interpolate %a/%e/%v template variables in a text string.
 * Shared by proc formatting AND boss-flavor formatting to prevent sync drift.
 * Thin wrapper over renderFlavor so both token styles work.
 */
export function interpolateTemplate(
  text: string,
  attackerName: string,
  targetName: string,
  value: number,
): string {
  return renderFlavor(text, { creature: attackerName, target: targetName, damage: value });
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
