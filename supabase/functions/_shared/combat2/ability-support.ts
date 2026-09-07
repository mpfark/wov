/**
 * Release gate for authored Combat2 abilities.
 *
 * An ability is supported only after every authored semantic branch has an
 * authoritative consumer. Keep this decision beside the canonical catalogue;
 * the Edge mirror is generated from this file and the SQL intent guard is
 * contract-tested against it.
 */
export const COMBAT2_UNSUPPORTED_ABILITIES = {} as const;

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
