/** Reuse one privileged HTTP client per warm worker; never retain player sessions. */
export function reusableRpcClient<T>(create: (url: string, key: string) => T) {
  let cached: { url: string; key: string; client: T } | undefined;
  return (url: string, key: string): T => {
    if (cached?.url === url && cached.key === key) return cached.client;
    const client = create(url, key);
    cached = { url, key, client };
    return client;
  };
}

export const ROUND_TARGET_MS = 150;
export function roundTiming(elapsedMs: number) {
  return { elapsedMs: Math.round(elapsedMs * 100) / 100,
    targetMs: ROUND_TARGET_MS, withinTarget: elapsedMs < ROUND_TARGET_MS };
}