export const APP_VERSION = "r7";

/**
 * Non-sensitive build identifier, recorded so a validation report can prove
 * which client bundle was tested.
 *
 * Presentation-only release: pairs with the unchanged Edge combat identity
 * (`EDGE_COMBAT_BUILD_ID` = `r8-bosscast-lifecycle-respawn-buildid`). This
 * frontend adds the local-death grammar fold ("You fall in battle" instead of
 * "You falls in battle") on the legacy name-substitution path.
 */
export const BUILD_ID = "r8-bosscast-lifecycle-deathgrammar";
