/**
 * Release gate for authored Combat2 abilities.
 *
 * An ability is supported only after every authored semantic branch has an
 * authoritative consumer. Keep this decision beside the canonical catalogue;
 * the Edge mirror is generated from this file and the SQL intent guard is
 * contract-tested against it.
 */
export const COMBAT2_UNSUPPORTED_ABILITIES = {
  conflagrate: 'Authored burn-stack consumption is not yet implemented.',
  consecrate: 'The node aura requires a safe multi-target effect representation.',
  crescendo: 'Party-wide periodic healing is not yet implemented.',
  divine_aegis: 'Authoritative ally targeting is not yet installed.',
  envenom: 'Authored on-hit poison stack application is not yet implemented.',
  eviscerate: 'Authored poison-stack consumption is not yet implemented.',
  ignite: 'Authored orb pulse attacks are not yet implemented.',
  inspire: 'The authored record does not define a regeneration interval.',
  purifying_light: 'Party-wide periodic healing is not yet implemented.',
  transfer_health: 'Authoritative ally targeting is not yet installed.',
} as const;

export type Combat2UnsupportedAbilityKey = keyof typeof COMBAT2_UNSUPPORTED_ABILITIES;

export interface Combat2AbilitySupport {
  supported: boolean;
  reason: string | null;
}

export function combat2AbilitySupport(abilityKey: string): Combat2AbilitySupport {
  const reason = (COMBAT2_UNSUPPORTED_ABILITIES as Record<string, string>)[abilityKey];
  return reason
    ? { supported: false, reason: `This ability is not yet available in Combat2. ${reason}` }
    : { supported: true, reason: null };
}
