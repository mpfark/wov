/**
 * http.ts — Phase 8 decomposition.
 *
 * Shared CORS headers, JSON response helper and JWT verification for combat
 * edge functions. Extracted verbatim from `combat-tick/index.ts`.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

export function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * JWT verification helper. Uses Supabase's getClaims() which validates the
 * signature locally against cached JWKS — no per-tick GoTrue round-trip, so it
 * avoids the 401-stall issue that previously motivated unsafe base64 payload
 * decoding. Returns null on any verification failure.
 */
export async function verifyUserIdFromJwt(
  authHeader: string | null,
  url: string,
  anonKey: string,
): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const userDb = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data, error } = await userDb.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub as string;
  } catch {
    return null;
  }
}
