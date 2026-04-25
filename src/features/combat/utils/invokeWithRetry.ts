/**
 * Wraps `supabase.functions.invoke` with a single retry on transient
 * platform errors (503 SUPABASE_EDGE_RUNTIME_ERROR, network blips,
 * cold-start hiccups). The edge function itself is healthy; these
 * 503s are the platform briefly being unable to route the request.
 *
 * One retry after a short backoff is enough to mask the vast majority
 * of these without changing the function's contract.
 */
import { supabase } from '@/integrations/supabase/client';

const TRANSIENT_PATTERNS = [
  'non-2xx status code',         // generic FunctionsHttpError wrapper
  '503',
  'temporarily unavailable',
  'edge_runtime_error',
  'failed to fetch',
];

function isTransient(err: unknown): boolean {
  if (!err) return false;
  const msg = (err as any)?.message?.toLowerCase?.() ?? '';
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
}

export async function invokeWithRetry<T = unknown>(
  fn: string,
  options: Parameters<typeof supabase.functions.invoke>[1],
  { retries = 1, backoffMs = 350 }: { retries?: number; backoffMs?: number } = {}
): Promise<{ data: T | null; error: any }> {
  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await supabase.functions.invoke(fn, options);
    if (!error) return { data: data as T, error: null };
    lastErr = error;
    if (attempt === retries || !isTransient(error)) break;
    await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
  }
  return { data: null, error: lastErr };
}
