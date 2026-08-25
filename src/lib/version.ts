export const APP_VERSION = "r7";

/**
 * Non-sensitive build identifier, recorded so a validation report can prove
 * which client bundle was tested. Contains only the short commit of the
 * reviewed repository state at publish time.
 *
 * Must be released together with the matching Edge combat build identity
 * (`EDGE_COMBAT_BUILD_ID`, `r7-mitigation-fold-buildid`): this release pairs
 * the correlated boss-cast mitigation contract (full mitigation folds into one
 * defensive line) with the deployed aggression and boss-cast behaviour.
 */
export const BUILD_ID = "r7-mitigation-fold";
