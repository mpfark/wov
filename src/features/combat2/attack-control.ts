export function shouldShowAttackControl(options: {
  authoritative: boolean;
  living: boolean;
  engaged: boolean;
  pending: boolean;
  legacyAvailable: boolean;
}): boolean {
  return options.authoritative
    ? options.living && !options.engaged && !options.pending
    : options.legacyAvailable;
}
