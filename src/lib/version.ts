export const APP_VERSION = "r7";

/**
 * Non-sensitive build identifier, recorded so a validation report can prove
 * which client bundle was tested. Contains only the short commit of the
 * reviewed repository state at publish time.
 *
 * Must be released together with the matching Edge combat build identity
 * (`EDGE_COMBAT_BUILD_ID`, `r7-bosscast-flavor-buildid`): this release pairs
 * the boss-cast flavor-token substitution (%a resolves to the acting creature)
 * with applied-damage presentation on a landed cast.
 */
export const BUILD_ID = "r7-bosscast-flavor";
