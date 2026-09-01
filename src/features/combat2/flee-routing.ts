/** Selects exactly one departure authority before the existing physical move continues. */
export async function authorizeCombat2MovementFlee(
  authorizeCombat2Flee: (() => Promise<boolean>) | undefined,
  legacyFlee: () => void,
): Promise<boolean> {
  if (!authorizeCombat2Flee) {
    legacyFlee();
    return true;
  }
  return authorizeCombat2Flee();
}
