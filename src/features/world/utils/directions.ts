/**
 * Compass direction helpers for in-world dialogue.
 * Uses the same grid convention as NodeEditorPanel: y -1 = North.
 */
export type Compass =
  | 'north' | 'north-east' | 'east' | 'south-east'
  | 'south' | 'south-west' | 'west' | 'north-west'
  | 'here';

export interface DirectionHint {
  compass: Compass;
  distance: 'here' | 'nearby' | 'moderate' | 'far';
  steps: number; // Chebyshev distance in grid units
}

/** Compute compass + rough distance from one node to another. */
export function describeDirection(
  from: { x: number; y: number; region_id?: string },
  to: { x: number; y: number; region_id?: string },
): DirectionHint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  if (steps === 0) {
    return { compass: 'here', distance: 'here', steps: 0 };
  }

  // Angle in radians, then map to 8-way compass. Note: y grows southward.
  const angle = Math.atan2(dy, dx); // -PI..PI
  const deg = (angle * 180) / Math.PI; // -180..180
  // East=0, South=90, West=180, North=-90
  let compass: Compass;
  if (deg >= -22.5 && deg < 22.5) compass = 'east';
  else if (deg >= 22.5 && deg < 67.5) compass = 'south-east';
  else if (deg >= 67.5 && deg < 112.5) compass = 'south';
  else if (deg >= 112.5 && deg < 157.5) compass = 'south-west';
  else if (deg >= -67.5 && deg < -22.5) compass = 'north-east';
  else if (deg >= -112.5 && deg < -67.5) compass = 'north';
  else if (deg >= -157.5 && deg < -112.5) compass = 'north-west';
  else compass = 'west';

  let distance: DirectionHint['distance'];
  if (steps <= 2) distance = 'nearby';
  else if (steps <= 6) distance = 'moderate';
  else distance = 'far';

  return { compass, distance, steps };
}

const DISTANCE_PHRASE: Record<DirectionHint['distance'], string> = {
  here: 'right here',
  nearby: 'not far',
  moderate: 'a fair journey',
  far: 'a long road',
};

/** Render a human sentence: "lies to the north-east — a fair journey from here." */
export function directionSentence(hint: DirectionHint): string {
  if (hint.compass === 'here') return 'is right here in this very place';
  return `lies to the ${hint.compass} — ${DISTANCE_PHRASE[hint.distance]} from here`;
}
