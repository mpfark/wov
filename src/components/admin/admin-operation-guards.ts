export function createSubmissionFence() {
  let activeToken: number | null = null;
  let generation = 0;

  return {
    tryAcquire(): number | false {
      if (activeToken !== null) return false;
      generation += 1;
      activeToken = generation;
      return activeToken;
    },
    release(token?: number): boolean {
      if (activeToken === null || (token !== undefined && token !== activeToken)) return false;
      activeToken = null;
      return true;
    },
    invalidate(): void {
      generation += 1;
      activeToken = null;
    },
    isCurrent(token: number): boolean {
      return activeToken === token;
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
