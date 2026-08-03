/**
 * cast-flavor.ts — Pure cast-time flavor lines for queued abilities.
 *
 * Emitted to the event log the moment a damage/heal ability is queued for
 * the next heartbeat tick. Replaces the silent "button-pulses-only" state.
 *
 * Format: the flavor sentence alone — no `[N]` suffix (no damage yet).
 */

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface FlavorVariants {
  /** One or more variants. `{target}` is substituted with the resolved target name. */
  withTarget?: string[];
  /** Variants used when there is no creature target (heals etc). */
  selfOrAlly?: string[];
}

const FLAVOR: Record<string, FlavorVariants> = {
  // ── T0 openers ──────────────────────────────────────────────
  fireball: {
    withTarget: [
      'You weave arcane flame between your fingers, aimed at {target}…',
      'Embers spiral into a roaring sphere above your palm, drifting toward {target}…',
    ],
  },
  power_strike: {
    withTarget: [
      'You set your stance and ready a crushing blow against {target}…',
      'Knuckles whiten on your grip as you wind up on {target}…',
    ],
  },
  aimed_shot: {
    withTarget: [
      'You draw, breathe, and steady your aim on {target}…',
      'The bowstring sings against your ear as you sight {target}…',
    ],
  },
  backstab: {
    withTarget: [
      'You slip behind {target}, blade reversed…',
      'Soft footfalls — and then you are at {target}\'s back…',
    ],
  },
  cutting_words: {
    withTarget: [
      'You take a breath, voice sharpening for {target}…',
      'A barbed verse rises in your throat, aimed at {target}…',
    ],
  },
  // smite is shared by healer and templar — branched in getCastFlavor()

  // ── Higher-tier server-resolved ─────────────────────────────
  multi_attack: {
    withTarget: [
      'You nock three arrows and draw, sighting {target}…',
      'Fletchings between your knuckles — the volley loosens toward {target}…',
    ],
  },
  dot_debuff: {
    withTarget: [
      'You ready a tearing cut across {target}…',
      'Your blade angles low for a wound that will not close on {target}…',
    ],
  },
  sunder_debuff: {
    withTarget: [
      "You wind back to crush {target}'s guard…",
      "You aim a shattering blow at {target}'s armor…",
    ],
  },
  execute_attack: {
    withTarget: [
      'You coil to detonate the venom in {target}…',
      'Every poisoned stack burns — you draw to ignite {target}…',
    ],
  },
  ignite_consume: {
    withTarget: [
      'You reach out to ignite the embers burning {target}…',
      'You will the smoldering coals on {target} to erupt…',
    ],
  },
  burst_damage: {
    withTarget: [
      'You inhale, the final chord rising toward {target}…',
      'You gather every note for one shattering crescendo upon {target}…',
    ],
  },

  // ── Heals / supports ────────────────────────────────────────
  hp_transfer: {
    withTarget: [
      'You open a vein of life, willing it toward {target}…',
      'You press your hand to your chest and pour warmth into {target}…',
    ],
  },
  heal: {
    selfOrAlly: [
      'You gather warm light around yourself…',
      'You breathe deep and call radiance into your wounds…',
    ],
  },
  self_heal: {
    selfOrAlly: [
      'You plant your feet and catch your breath…',
      'You shake off the haze and steady yourself…',
    ],
  },
};

// Smite is shared — separate tables keyed on character class.
const SMITE_FLAVOR_BY_CLASS: Record<string, string[]> = {
  templar: [
    'You raise your hand and call judgment down on {target}…',
    'Holy light kindles at your fingertips, sentence pronounced on {target}…',
  ],
  healer: [
    'You channel divine light toward {target}…',
    'A shaft of pale radiance gathers above {target}…',
  ],
};

function substitute(template: string, target: string | null): string {
  return template.replace('{target}', target ?? 'your foe');
}

/**
 * Returns the cast-time flavor line for a queued ability, or null when the
 * ability type has no defined cast flavor (caller should skip emitting).
 */
export function getCastFlavor(
  abilityType: string,
  characterClass: string,
  targetName: string | null,
): string | null {
  if (abilityType === 'smite') {
    const variants = SMITE_FLAVOR_BY_CLASS[characterClass] ?? SMITE_FLAVOR_BY_CLASS.healer;
    return substitute(pick(variants), targetName);
  }

  const entry = FLAVOR[abilityType];
  if (!entry) return null;

  if (entry.withTarget && entry.withTarget.length > 0) {
    return substitute(pick(entry.withTarget), targetName);
  }
  if (entry.selfOrAlly && entry.selfOrAlly.length > 0) {
    return pick(entry.selfOrAlly);
  }
  return null;
}
