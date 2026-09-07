export const COMBAT2_TICK_MS = 2000;

/** Convert authored milliseconds without shortening or accelerating the effect. */
export function combat2TicksForMs(milliseconds: number): number {
  return Math.max(1, Math.ceil(Math.max(0, milliseconds) / COMBAT2_TICK_MS));
}

export interface Combat2TickTiming {
  activated_at_tick: number;
  expires_after_tick: number;
  interval_ticks: number;
  next_pulse_tick: number;
}

export function combat2TickTiming(
  activatedAtTick: number,
  durationMs: number,
  intervalMs: number = COMBAT2_TICK_MS,
): Combat2TickTiming {
  const intervalTicks = combat2TicksForMs(intervalMs);
  return {
    activated_at_tick: activatedAtTick,
    expires_after_tick: activatedAtTick + combat2TicksForMs(durationMs),
    interval_ticks: intervalTicks,
    next_pulse_tick: activatedAtTick + intervalTicks,
  };
}

export function readCombat2TickTiming(config: Record<string, unknown>): Combat2TickTiming | null {
  const values = ['activated_at_tick', 'expires_after_tick', 'interval_ticks', 'next_pulse_tick']
    .map(key => config[key]);
  if (!values.every(value => typeof value === 'number' && Number.isSafeInteger(value))) return null;
  const [activated_at_tick, expires_after_tick, interval_ticks, next_pulse_tick] = values as number[];
  if (activated_at_tick < 0 || expires_after_tick <= activated_at_tick || interval_ticks < 1
      || next_pulse_tick <= activated_at_tick || next_pulse_tick > expires_after_tick) return null;
  return { activated_at_tick, expires_after_tick, interval_ticks, next_pulse_tick };
}

export function combat2PulseDue(timing: Combat2TickTiming, tick: number, lastPulseTick: number | null): boolean {
  return tick >= timing.next_pulse_tick && tick <= timing.expires_after_tick
    && (tick - timing.next_pulse_tick) % timing.interval_ticks === 0
    && (lastPulseTick ?? -1) < tick;
}
