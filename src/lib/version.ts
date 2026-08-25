export const APP_VERSION = "r7";

/**
 * Non-sensitive build identifier, recorded so a validation report can prove
 * which client bundle was tested. Contains only the short commit of the
 * reviewed repository state at publish time.
 *
 * Must be released together with the matching Edge combat build identity
 * (`EDGE_COMBAT_BUILD_ID`, `r7-aggression-bosscast-buildid`): this release pairs
 * the restored damaged-creature aggression transition with the deployed
 * boss-cast contract and the truthful zero-damage cast outcome.
 */
export const BUILD_ID = "r7-aggression-bosscast";
