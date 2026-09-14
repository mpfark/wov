export function createSubmissionFence() {
  let active = false;

  return {
    tryAcquire(): boolean {
      if (active) return false;
      active = true;
      return true;
    },
    release(): void {
      active = false;
    },
  };
}

export function createLatestRequestGuard() {
  let generation = 0;

  return {
    begin(): number {
      generation += 1;
      return generation;
    },
    invalidate(): void {
      generation += 1;
    },
    isCurrent(candidate: number): boolean {
      return candidate === generation;
    },
  };
}
