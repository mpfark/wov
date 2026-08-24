/**
 * perspective.ts — deterministic second-person rendering for log prose.
 *
 * Pure string work with ONE rule: perspective is decided by structure, never
 * by a global capitalisation pass that could corrupt a name or a sentence
 * start. Authored templates substitute *markers* for the local character, and
 * this module resolves each marker from its position:
 *
 *   - possessive position (`{attacker}'s ward`) → `your` / `Your`
 *   - sentence-subject position                 → `You` (verb conjugated)
 *   - anywhere else (object, prepositional)     → `you`
 *
 * No React, no side effects.
 */

/** Marker substituted for the local character's name inside a template. */
export const SELF_MARKER = '\uE000';

/** Verbs whose second-person form is not just "drop the -s". */
const IRREGULAR_SECOND_PERSON: Record<string, string> = {
  has: 'have',
  is: 'are',
  does: 'do',
  goes: 'go',
  was: 'were',
};

/**
 * Turn a third-person singular verb into its second-person form.
 * Purely grammatical — the server authors third-person prose, so once the
 * local name folds to "You" the verb must follow ("You blocks" → "You block").
 *
 * Only a genuine sibilant/`o` cluster loses the whole `-es` ("passes" → "pass",
 * "goes" → "go"). Everything else drops the single `-s`, so "raises" becomes
 * "raise" rather than the truncated "rais".
 */
export function secondPersonVerb(verb: string): string {
  const irregular = IRREGULAR_SECOND_PERSON[verb];
  if (irregular) return irregular;
  if (!verb.endsWith('s')) return verb;
  if (/(?:ss|us|is)$/.test(verb)) return verb;
  if (/[^aeiou]ies$/.test(verb)) return `${verb.slice(0, -3)}y`;
  if (/(?:sh|ch|ss|x|z|o)es$/.test(verb)) return verb.slice(0, -2);
  return verb.slice(0, -1);
}


/**
 * Conjugate the verb that directly follows a folded "You" subject.
 * Only the pronoun subject is touched — "Your ward burns …" keeps its
 * third-person verb because the subject there is the ward, not the player.
 */
export function applySecondPersonGrammar(message: string): string {
  return message.replace(
    /(^|[.!?]\s+|\s)(You) ([a-z]+)\b/g,
    (_m, lead: string, subject: string, verb: string) => `${lead}${subject} ${secondPersonVerb(verb)}`,
  );
}

/** True when `prefix` ends where a new sentence begins. */
function atSentenceStart(prefix: string): boolean {
  return prefix.length === 0 || /(?:^|[.!?…]["')\]]?)\s+$/.test(prefix);
}

/**
 * Resolve every self marker into the correct pronoun for its position, then
 * conjugate the verb of any subject "You".
 */
export function resolveSelfMarkers(text: string): string {
  const resolved = text.replace(
    new RegExp(`${SELF_MARKER}('s)?`, 'g'),
    (_m, possessive: string | undefined, offset: number) => {
      const start = atSentenceStart(text.slice(0, offset));
      if (possessive) return start ? 'Your' : 'your';
      return start ? 'You' : 'you';
    },
  );
  return applySecondPersonGrammar(resolved);
}
